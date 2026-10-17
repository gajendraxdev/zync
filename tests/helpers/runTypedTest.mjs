import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

/** Execute checked TypeScript tests through the same bundler resolution as application code. */
export async function runTypedTest(testUrl) {
    const result = await build({
        entryPoints: [fileURLToPath(testUrl)],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
    });
    try {
        await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
