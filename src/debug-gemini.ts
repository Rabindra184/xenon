import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

async function debugGemini() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('No GEMINI_API_KEY found in .env');
        return;
    }

    console.log('Testing with API Key (truncated):', apiKey.substring(0, 5) + '...');

    try {
        const genAI = new GoogleGenerativeAI(apiKey);

        // Try v1 first
        console.log('\n--- Testing v1 Endpoint ---');
        try {
            const modelV1 = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' });
            const resultV1 = await modelV1.generateContent('Hi');
            console.log('v1 Success:', resultV1.response.text());
        } catch (e: any) {
            console.error('v1 Failed:', e.message);
        }

        // Try v1beta
        console.log('\n--- Testing v1beta Endpoint ---');
        try {
            const modelBeta = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1beta' });
            const resultBeta = await modelBeta.generateContent('Hi');
            console.log('v1beta Success:', resultBeta.response.text());
        } catch (e: any) {
            console.error('v1beta Failed:', e.message);
        }

    } catch (err: any) {
        console.error('Debug failed:', err.message);
    }
}

debugGemini();
