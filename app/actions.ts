'use server';

import { Company } from './lib/types';
import { Pool } from 'pg';
import zlib from 'zlib';
import { promisify } from 'util';
const gunzip = promisify(zlib.gunzip);
import { cookies, headers } from 'next/headers';
import { checkRateLimit, isUserLoggedIn, verifyUser } from './lib/auth';
import { redirect } from 'next/navigation';
import readline from 'readline';

const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
});

export async function loginAction(formData: FormData) {
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (await verifyUser(username, password)) {
        const cookieStore = await cookies();
        cookieStore.set('premium_session', 'true', {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24 * 7 // 1 week
        });
        return { success: true };
    }

    return { success: false, error: 'Invalid credentials' };
}

export async function logoutAction() {
    const cookieStore = await cookies();
    cookieStore.delete('premium_session');
    redirect('/');
}

export async function searchCompanies(query: string): Promise<{ results: Company[], error?: string, remaining?: number, isPremium?: boolean }> {
    if (!query || query.length < 2) return { results: [] };

    const isLoggedIn = await isUserLoggedIn();
    let remaining = -1;

    if (!isLoggedIn) {
        const headersList = await headers();
        const ip = headersList.get('x-forwarded-for') || '127.0.0.1';

        const limit = await checkRateLimit(ip);
        'use server';

        import { Company } from './lib/types';
        import { Pool } from 'pg';
        import zlib from 'zlib';
        import { promisify } from 'util';
        const gunzip = promisify(zlib.gunzip);
        import { cookies, headers } from 'next/headers';
        import { checkRateLimit, isUserLoggedIn, verifyUser } from './lib/auth';
        import { redirect } from 'next/navigation';
        import readline from 'readline';

        const pool = new Pool({
            connectionString: process.env.POSTGRES_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
        });

        export async function loginAction(formData: FormData) {
            const username = formData.get('username') as string;
            const password = formData.get('password') as string;

            if (await verifyUser(username, password)) {
                const cookieStore = await cookies();
                cookieStore.set('premium_session', 'true', {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    maxAge: 60 * 60 * 24 * 7 // 1 week
                });
                return { success: true };
            }

            return { success: false, error: 'Invalid credentials' };
        }

        export async function logoutAction() {
            const cookieStore = await cookies();
            cookieStore.delete('premium_session');
            redirect('/');
        }

        export async function searchCompanies(query: string): Promise<{ results: Company[], error?: string, remaining?: number, isPremium?: boolean }> {
            if (!query || query.length < 2) return { results: [] };

            const isLoggedIn = await isUserLoggedIn();
            let remaining = -1;

            if (!isLoggedIn) {
                const headersList = await headers();
                const ip = headersList.get('x-forwarded-for') || '127.0.0.1';

                const limit = await checkRateLimit(ip);
                if (!limit.allowed) {
                    return {
                        results: [],
                        error: 'Free search limit exceeded (10/day). Please login for unlimited access.',
                        remaining: 0,
                        isPremium: false
                    };
                }
                remaining = limit.remaining;
            }

            try {
                const client = await pool.connect();
                try {
                    // Full text search using tsvector if available, or ILIKE
                    // Using ILIKE for simplicity and partial matching
                    const result = await client.query(`
                SELECT * FROM companies 
                WHERE name ILIKE $1 OR cin ILIKE $1 
                LIMIT 50
            `, [`%${query}%`]);

                    const results: Company[] = result.rows.map(row => ({
                        id: row.id.toString(),
                        name: row.name,
                        state: row.state || '',
                        cin: row.cin,
                        status: row.status,
                        ...row.raw_data
                    }));

                    return {
                        results,
                        remaining,
                        isPremium: isLoggedIn
                    };
                } finally {
                    client.release();
                }
            } catch (error) {
                console.error('Database search failed:', error);
                // Fallback to empty if DB fails
                return { results: [] };
            }
        }
