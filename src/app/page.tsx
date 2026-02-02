'use client';

import { useState } from 'react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [threshold, setThreshold] = useState<string>('2'); // default 2 days
  const [lostSignal, setLostSignal] = useState<any[]>([]);
  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!file) return setError('Please upload an Excel file');
    if (!threshold || isNaN(Number(threshold)) || Number(threshold) < 0) {
      return setError('Please enter a valid number for days threshold');
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('threshold', threshold);

    try {
      const res = await fetch('/api/process', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Processing failed');

      const { lost, groups: g, excelBase64, generatedAt } = await res.json();

      setLostSignal(lost);
      setGroups(g);
      setDownloadUrl(`data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${excelBase64}`);
      setFileName(`customized_report_${generatedAt}.xlsx`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-8 text-center">GPS Signal Report Generator</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Upload Excel */}
        <div>
          <label className="block text-lg font-medium mb-2">Upload Excel File</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-gray-900 border border-gray-300 rounded-lg cursor-pointer bg-gray-50 focus:outline-none p-2"
          />
        </div>

        {/* Days Threshold */}
        <div>
          <label className="block text-lg font-medium mb-2">Threshold (days)</label>
          <input
            type="number"
            min="0"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="e.g. 2"
            className="block w-full p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-sm text-gray-500 mt-1">
            Lost signal = delay ≥ {threshold} days<br />
            Recent vehicles = delay ≤ {threshold} days
          </p>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={loading || !file}
        className={`w-full md:w-auto px-8 py-3 text-white font-medium rounded-lg ${
          loading || !file ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
        } transition`}
      >
        {loading ? 'Processing...' : 'Generate Excel'}
      </button>

      {error && <p className="text-red-600 mt-4 text-center font-medium">{error}</p>}

      {/* Results */}
      {lostSignal.length > 0 && (
        <div className="mt-12">
          <h2 className="text-2xl font-bold mb-4">GPS Lost Signal (delay ≥ {threshold} days)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-4 py-2">Number</th>
                  <th className="border px-4 py-2">License Plate</th>
                  <th className="border px-4 py-2">Date</th>
                  <th className="border px-4 py-2">City</th>
                  <th className="border px-4 py-2">Delay (days)</th>
                </tr>
              </thead>
              <tbody>
                {lostSignal.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="border px-4 py-2 text-center">{row.number}</td>
                    <td className="border px-4 py-2">{row.license_plate}</td>
                    <td className="border px-4 py-2">{row.date}</td>
                    <td className="border px-4 py-2">{row.address}</td>
                    <td className="border px-4 py-2 text-center">{row.delay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-2xl font-bold mt-10 mb-4">Recent Vehicles by Location (delay ≤ {threshold} days)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(groups).map(([city, plates]) => (
              <div key={city} className="border rounded-lg p-4 bg-white shadow-sm">
                <h3 className="font-bold text-lg mb-2">{city}</h3>
                <ol className="list-decimal pl-5 space-y-1">
                  {plates.map((plate, i) => (
                    <li key={i}>{plate}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>

          {downloadUrl && (
            <div className="mt-10 text-center">
              <a
                href={downloadUrl}
                download={fileName}
                className="inline-block px-10 py-4 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition text-lg"
              >
                Download Report → {fileName}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}