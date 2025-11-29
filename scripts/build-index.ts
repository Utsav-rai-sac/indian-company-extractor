
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { SearchIndex } from '../app/lib/types';
import zlib from 'zlib';

const PUBLIC_DATA_DIR = path.join(process.cwd(), 'public', 'data');
const INDEX_FILE = path.join(PUBLIC_DATA_DIR, 'search-index.json.gz');

async function buildIndex() {
    console.log('Starting optimized index build (Byte Offsets)...');
    const startTime = Date.now();

    const newIndex: SearchIndex[] = [];

    try {
        if (!fs.existsSync(PUBLIC_DATA_DIR)) {
            console.warn('Public Data directory missing!');
            return;
        }

        const files = fs.readdirSync(PUBLIC_DATA_DIR);

        for (const file of files) {
            if (!file.match(/\.(csv|xlsx|xls|json)$/)) continue;
            if (file.endsWith('.bak')) continue;
            if (file.startsWith('search-index')) continue;

            console.log(`Processing ${file}...`);
            const filePath = path.join(PUBLIC_DATA_DIR, file);

            if (file.endsWith('.csv')) {
                // Read file as buffer to track byte offsets
                const fileBuffer = fs.readFileSync(filePath);
                let lineStart = 0;
                let isHeader = true;
                let nameIdx = -1, cinIdx = -1, stateIdx = -1, statusIdx = -1;

                // Iterate through buffer to find newlines
                for (let i = 0; i < fileBuffer.length; i++) {
                    if (fileBuffer[i] === 10) { // Newline \n
                        const lineEnd = i;
                        const lineBuffer = fileBuffer.subarray(lineStart, lineEnd);
                        const lineStr = lineBuffer.toString('utf-8').trim();

                        // Parse CSV line (simple)
                        // Note: This simple parser assumes no newlines inside quotes, which is standard for these files
                        const values: string[] = [];
                        let inQuote = false;
                        let currentVal = '';

                        for (let j = 0; j < lineStr.length; j++) {
                            const char = lineStr[j];
                            if (char === '"') {
                                inQuote = !inQuote;
                            } else if (char === ',' && !inQuote) {
                                values.push(currentVal.trim());
                                currentVal = '';
                            } else {
                                currentVal += char;
                            }
                        }
                        values.push(currentVal.trim());
                        const cleanValues = values.map(v => v.replace(/^"|"$/g, '').trim());

                        if (isHeader) {
                            nameIdx = cleanValues.findIndex(h => h.match(/Company.*Name|Name/i));
                            cinIdx = cleanValues.findIndex(h => h.match(/CIN/i));
                            stateIdx = cleanValues.findIndex(h => h.match(/State|CompanyStateCode/i));
                            statusIdx = cleanValues.findIndex(h => h.match(/Status|CompanyStatus/i));
                            isHeader = false;
                        } else {
                            const name = (nameIdx >= 0 ? cleanValues[nameIdx] : '') || 'Unknown';
                            const cin = (cinIdx >= 0 ? cleanValues[cinIdx] : '') || '';
                            const state = (stateIdx >= 0 ? cleanValues[stateIdx] : '') || '';
                            const status = (statusIdx >= 0 ? cleanValues[statusIdx] : '') || '';

                            if (name !== 'Unknown') {
                                newIndex.push({
                                    n: name.toLowerCase(),
                                    c: cin,
                                    s: state,
                                    st: status,
                                    f: file,
                                    b: lineStart,
                                    l: lineEnd - lineStart,
                                    r: name
                                });
                            }
                        }
                        lineStart = i + 1;
                    }
                }
            } else {
                // Excel/JSON fallback (cannot use byte offsets easily, so we skip or load all)
                // For now, we skip Excel files in this optimized version or convert them to CSV first
                console.warn(`Skipping ${file} (Only CSV supported for byte-offset optimization)`);
            }
        }

        console.log(`Compressing and writing index to ${INDEX_FILE}...`);
        const jsonString = JSON.stringify(newIndex);
        const compressed = zlib.gzipSync(jsonString);
        fs.writeFileSync(INDEX_FILE, compressed);

        console.log(`Index built in ${Date.now() - startTime}ms.`);
        console.log(`Total records: ${newIndex.length}`);
        console.log(`Compressed size: ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);

    } catch (e) {
        console.error('Index build failed:', e);
        process.exit(1);
    }
}

buildIndex();
