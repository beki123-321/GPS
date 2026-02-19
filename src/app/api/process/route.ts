// import * as XLSX from 'xlsx';
import { NextRequest, NextResponse } from 'next/server';
import { read, utils, write } from 'xlsx';
import { parse, format, differenceInDays } from 'date-fns';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const thresholdStr = formData.get('threshold') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (!thresholdStr || isNaN(Number(thresholdStr))) {
      return NextResponse.json({ error: 'Invalid threshold value' }, { status: 400 });
    }

    const threshold = Number(thresholdStr);

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const data: any[] = utils.sheet_to_json(sheet, {
      header: ['license_plate', 'date_str', 'address'],
      defval: '',
      blankrows: false,
      range: 1,
    });

    const currentDate = new Date();

    const processed = data
      .map((row, index) => {
        try {
          const datePart = (row.date_str || '').toString().trim().split(' ')[0];
          let parsedDate: Date;

          if (!datePart) {
            parsedDate = new Date(0);
          } else {
            parsedDate = parse(datePart, 'MM/dd/yyyy', new Date());
            if (isNaN(parsedDate.getTime())) {
              parsedDate = new Date(0);
            }
          }

          const delay = differenceInDays(currentDate, parsedDate);
          const city = extractCity(row.address?.toString() || '');

          return { ...row, parsed_date: parsedDate, delay, city };
        } catch (e) {
          return null;
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const lost = processed
      .filter((r) => r.delay >= threshold)
      .sort((a, b) => b.delay - a.delay)
      .map((r, i) => ({
        number: i + 1,
        license_plate: r.license_plate.trim(),
        date: format(r.parsed_date, 'MM/dd/yyyy'),
        address: r.city,
        delay: r.delay,
      }));

    const recent = processed.filter((r) => r.delay < threshold);
    const groups: Record<string, string[]> = {};
    recent.forEach((r) => {
      const c = r.city || 'Unknown';
      if (!groups[c]) groups[c] = [];
      groups[c].push(r.license_plate.trim());
    });

    const sortedGroups = Object.fromEntries(
      Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
    );

    // ────────────────────────────────────────────────
    //          BUILD EXCEL - EXACT LAYOUT LIKE YOUR EXAMPLE
    // ────────────────────────────────────────────────
    const wb = utils.book_new();
    const sheetData: any[][] = [];

    // Top headers (duplicated for live and lost sections)
    sheetData.push([
      'Vehicle status from GPS',
      ...Array(9).fill(''),
      'Vehicle status from GPS',
      ...Array(3).fill(''),
      `Date ${format(currentDate, 'dd/MM/yyyy')}`,
    ]);
    sheetData.push(['To:- General Manager', ...Array(9).fill(''), 'To:- General Manager']);
    sheetData.push(['To:- Freight Transport Director', ...Array(9).fill(''), 'To:- Freight Transport Director']);
    sheetData.push([]);

    // Section titles
    sheetData.push(['GPS Live Signal', ...Array(9).fill(''), 'GPS Lost Signal']);

    const LIVE_START_ROW = sheetData.length; // row for live data start
    const LOST_START_COL = 12; // column K (0-based: 10) for lost table start

    // Prepare lost table data
    const lostTableData: any[][] = [
      ['number', 'license_plate', 'date', 'Address', 'delay/days'],
      ...lost.map((r) => [r.number, r.license_plate, r.date, r.address, r.delay]),
    ];

    // Live section - 2-column blocks, wrap every 41 rows (including city header)
    const MAX_ROWS_PER_BLOCK = 41;
    let liveRow = LIVE_START_ROW;
    let liveCol = 0;
    const merges: any[] = [];

    Object.entries(sortedGroups).forEach(([city, plates]) => {
      const groupRows = 1 + plates.length; // city + plates

      if (liveRow - LIVE_START_ROW + groupRows > MAX_ROWS_PER_BLOCK) {
        liveCol += 2;
        liveRow = LIVE_START_ROW;
      }

      // Ensure rows exist up to needed
      while (sheetData.length <= liveRow + groupRows) {
        sheetData.push([]);
      }

      // City header (merge 2 columns)
      sheetData[liveRow][liveCol] = city;
      sheetData[liveRow][liveCol + 1] = '';
      merges.push({
        s: { r: liveRow, c: liveCol },
        e: { r: liveRow, c: liveCol + 1 },
      });

      // Plates
      plates.forEach((plate, i) => {
        const r = liveRow + i + 1;
        sheetData[r][liveCol] = i + 1;
        sheetData[r][liveCol + 1] = plate;
      });

      liveRow += groupRows + 1; // spacer
    });

    // Add lost table to right side (starting from LOST_START_COL)
    const lostStartRow = LIVE_START_ROW;
    lostTableData.forEach((lostRow, i) => {
      const targetRow = lostStartRow + i;
      while (sheetData.length <= targetRow) sheetData.push([]);

      lostRow.forEach((val, j) => {
        sheetData[targetRow][LOST_START_COL + j] = val;
      });
    });

    // Summary at bottom
    const summaryRow = Math.max(sheetData.length, lostStartRow + lostTableData.length + 2);
    while (sheetData.length <= summaryRow) sheetData.push([]);
    sheetData[summaryRow][0] = 
      `Total= Live GPS Vehicles ${recent.length} And ${lost.length} Vehicle are Lost GPS Signal == ${recent.length + lost.length}`;

    // Create worksheet with merges
    const ws = utils.aoa_to_sheet(sheetData);
    ws['!merges'] = merges;

    // Auto column widths
    const range = utils.decode_range(ws['!ref'] || 'A1');
    ws['!cols'] = [];
    for (let c = 0; c <= range.e.c; c++) {
      let maxw = 10;
      for (let r = 0; r <= range.e.r; r++) {
        const cell = ws[utils.encode_cell({ r, c })];
        if (cell && cell.v) {
          maxw = Math.max(maxw, String(cell.v).length);
        }
      }
      ws['!cols'][c] = { wch: Math.min(maxw + 2, 40) };
    }

    utils.book_append_sheet(wb, ws, 'Sheet1');

    const excelBase64 = write(wb, { bookType: 'xlsx', type: 'base64' });

    return NextResponse.json({
      lost,
      groups: sortedGroups,
      excelBase64,
      generatedAt: format(currentDate, 'yyyy-MM-dd'),
    });
  } catch (error: any) {
    console.error('API processing error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error during Excel generation' },
      { status: 500 }
    );
  }
}

function extractCity(address: string): string {
  if (!address?.trim()) return 'Unknown';

  let addr = address.toLowerCase().trim();

  if (addr.includes('djibouti')) return 'Djibouti';

  addr = addr.replace(/adiss - adama expy|addis - adama expy|addis - adama/gi, 'addis–adama expressway');
  addr = addr.replace(/kembolcha/gi, 'kombolcha');
  addr = addr.replace(/\b[a-z0-9]{4}\+[a-z0-9]{2,}\b/gi, '');
  addr = addr.replace(/\+/g, ' ');
  addr = addr.replace(/emergency relief head office|adama garage|awel building|senegal st|unnamed road|addis - wonje road/gi, '');
  addr = addr.replace(/^(a\d+[a]?|n\d+|rn\d+|b\d+|d\d+|e\d+|a10a?)\s*,?/gi, '');
  addr = addr.replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim().replace(/^[,\s]+|[,\s]+$/g, '');

  const parts = addr.split(',').map(p => p.trim()).filter(Boolean);

  const amharicMap: Record<string, string> = {
    'አዲስ አበባ': 'Addis Ababa',
    'ኣዳማ': 'Adama',
    'ጅጅጋ': 'Jijiga',
    'ኮምቦልቻ': 'Kombolcha',
  };

  let city = 'Unknown';
  for (let i = parts.length - 1; i >= 0; i--) {
    let p = parts[i];
    if (!p || p === 'ethiopia') continue;

    city = amharicMap[p] || p;

    city = city
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace(/\w+\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());

    if (city !== 'Unknown') break;
  }

  if (/expressway|expy/i.test(city)) city = 'Addis–Adama Expressway';
  if (/kombolcha/i.test(city)) city = 'Kombolcha';

  return city;
}
