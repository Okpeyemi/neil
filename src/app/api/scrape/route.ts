import { spawn } from 'child_process';

// Basic API endpoint to trigger scraper (non-blocking). For controlled use only.
export async function POST() {
  // spawn separate process so it does not block the lambda (may not be ideal on serverless; for dev only)
  const child = spawn('npm', ['run', 'scrape'], {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return new Response(JSON.stringify({ status: 'started' }), { status: 202 });
}
