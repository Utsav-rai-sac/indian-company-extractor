
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const BATCH_SIZE = 5;

async function pushDataInBatches() {
    console.log('Resuming batch push...');

    // 1. Try to push any pending commits first
    try {
        console.log('Checking for pending pushes...');
        execSync('git push origin main');
        console.log('Pending commits pushed.');
    } catch (e) {
        console.log('Push failed or nothing to push. Continuing...');
    }

    if (!fs.existsSync(DATA_DIR)) return;

    const files = fs.readdirSync(DATA_DIR).filter(f => !f.endsWith('.bak') && !f.endsWith('.gz'));

    // Get list of already tracked files to skip them? 
    // Or just rely on git commit failing if nothing changes.

    let currentBatch: string[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Check if file is already committed (git ls-files)
        try {
            const isTracked = execSync(`git ls-files "public/data/${file}"`).toString().trim().length > 0;
            if (isTracked) continue; // Skip already tracked files
        } catch (e) { }

        currentBatch.push(path.join('public', 'data', file));

        if (currentBatch.length >= BATCH_SIZE || (i === files.length - 1 && currentBatch.length > 0)) {
            console.log(`Processing batch... (${currentBatch.length} files)`);

            try {
                const filesStr = currentBatch.map(f => `"${f}"`).join(' ');
                execSync(`git add ${filesStr}`);

                try {
                    execSync(`git commit -m "data: batch ${Math.ceil((i + 1) / BATCH_SIZE)}"`);
                    console.log('Batch committed.');

                    console.log('Pushing batch...');
                    execSync('git push origin main');
                    console.log('Batch pushed.');
                } catch (e: any) {
                    if (e.stdout?.toString().includes('nothing to commit')) {
                        console.log('Nothing to commit for this batch.');
                    } else {
                        throw e;
                    }
                }

                currentBatch = [];
            } catch (e) {
                console.error('Failed to process batch:', e);
                // Don't exit, try next batch? No, order matters? 
                // Actually if push fails, we should stop.
                process.exit(1);
            }
        }
    }

    // Index file
    const indexFile = 'public/data/search-index.json.gz';
    if (fs.existsSync(indexFile)) {
        try {
            const isTracked = execSync(`git ls-files "${indexFile}"`).toString().trim().length > 0;
            if (!isTracked) {
                console.log('Pushing search index...');
                execSync(`git add "${indexFile}"`);
                execSync(`git commit -m "data: search index"`);
                execSync('git push origin main');
            }
        } catch (e) {
            console.error('Failed to push index:', e);
        }
    }
}

pushDataInBatches();
