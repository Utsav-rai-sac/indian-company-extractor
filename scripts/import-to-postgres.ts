
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';

dotenv.config({ path: '.env.local' });

if (!process.env.POSTGRES_URL) {
    console.error('POSTGRES_URL environment variable is missing!');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
});

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

async function importData() {
    console.log('Connecting to database...');
    const client = await pool.connect();

    try {
        console.log('Creating table if not exists...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS companies (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                cin TEXT,
                state TEXT,
                status TEXT,
                raw_data JSONB,
                source_file TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_companies_name ON companies USING GIN (to_tsvector('english', name));
            CREATE INDEX IF NOT EXISTS idx_companies_cin ON companies(cin);
        `);

        if (!fs.existsSync(DATA_DIR)) {
            console.log('No data directory found.');
            return;
        }

        const files = fs.readdirSync(DATA_DIR).filter(f => !f.endsWith('.bak') && !f.endsWith('.gz') && !f.startsWith('search-index'));
        console.log(`Found ${files.length} files to import.`);

        for (const file of files) {
            console.log(`Importing ${file}...`);
            const filePath = path.join(DATA_DIR, file);

            // Check if file already imported (optional optimization)
            // const res = await client.query('SELECT 1 FROM companies WHERE source_file = $1 LIMIT 1', [file]);
            // if (res.rowCount > 0) {
            //     console.log(`Skipping ${file} (already imported)`);
            //     continue;
            // }

            const rowsToInsert: any[] = [];
            const BATCH_SIZE = 1000;

            if (file.endsWith('.csv')) {
                const fileStream = fs.createReadStream(filePath);
                const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

                let isHeader = true;
                let header: string[] = [];
                let nameIdx = -1, cinIdx = -1, stateIdx = -1, statusIdx = -1;

                for await (const line of rl) {
                    // Simple CSV parser
                    const values: string[] = [];
                    let inQuote = false;
                    let currentVal = '';
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        if (char === '"') inQuote = !inQuote;
                        else if (char === ',' && !inQuote) {
                            values.push(currentVal.trim());
                            currentVal = '';
                        } else currentVal += char;
                    }
                    values.push(currentVal.trim());
                    const cleanValues = values.map(v => v.replace(/^"|"$/g, '').trim());

                    if (isHeader) {
                        header = cleanValues;
                        nameIdx = cleanValues.findIndex(h => h.match(/Company.*Name|Name/i));
                        cinIdx = cleanValues.findIndex(h => h.match(/CIN/i));
                        stateIdx = cleanValues.findIndex(h => h.match(/State|CompanyStateCode/i));
                        statusIdx = cleanValues.findIndex(h => h.match(/Status|CompanyStatus/i));
                        isHeader = false;
                        continue;
                    }

                    const name = (nameIdx >= 0 ? cleanValues[nameIdx] : '') || 'Unknown';
                    const cin = (cinIdx >= 0 ? cleanValues[cinIdx] : '') || null;
                    const state = (stateIdx >= 0 ? cleanValues[stateIdx] : '') || null;
                    const status = (statusIdx >= 0 ? cleanValues[statusIdx] : '') || null;

                    if (name !== 'Unknown') {
                        const rawData: any = {};
                        header.forEach((h, i) => rawData[h] = cleanValues[i]);

                        rowsToInsert.push([name, cin, state, status, JSON.stringify(rawData), file]);
                    }

                    if (rowsToInsert.length >= BATCH_SIZE) {
                        await insertBatch(client, rowsToInsert);
                        rowsToInsert.length = 0;
                    }
                }
            } else {
                // Excel/JSON
                const fileBuffer = fs.readFileSync(filePath);
                const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const data = XLSX.utils.sheet_to_json<any>(sheet);

                for (const row of data) {
                    const name = row['CompanyName'] || row['Company Name'] || row['Name'] || 'Unknown';
                    const cin = row['CIN'] || null;
                    const state = row['CompanyStateCode'] || row['State'] || null;
                    const status = row['CompanyStatus'] || row['Status'] || null;

                    if (name !== 'Unknown') {
                        rowsToInsert.push([name, cin, state, status, JSON.stringify(row), file]);
                    }

                    if (rowsToInsert.length >= BATCH_SIZE) {
                        await insertBatch(client, rowsToInsert);
                        rowsToInsert.length = 0;
                    }
                }
            }

            if (rowsToInsert.length > 0) {
                await insertBatch(client, rowsToInsert);
            }
        }

        console.log('Import completed successfully!');

    } catch (e) {
        console.error('Import failed:', e);
    } finally {
        client.release();
        await pool.end();
    }
}

async function insertBatch(client: any, rows: any[]) {
    if (rows.length === 0) return;

    // Construct query
    // INSERT INTO companies (name, cin, state, status, raw_data, source_file) VALUES ...
    const placeholders = rows.map((_, i) =>
        `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`
    ).join(',');

    const flatValues = rows.flat();

    await client.query(
        `INSERT INTO companies (name, cin, state, status, raw_data, source_file) VALUES ${placeholders}`,
        flatValues
    );
    process.stdout.write('.');
}

importData();
