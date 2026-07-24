import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.MARK_NVIDIA_FIXTURE_PORT ?? 5676);

const scenarios = {
  '/401': { status: 401, body: { error: 'controlled unauthorized' } },
  '/429': { status: 429, headers: { 'Retry-After': '7' }, body: { error: 'controlled rate limit' } },
  '/503': { status: 503, body: { error: 'controlled service unavailable' } },
};

const server = http.createServer((request, response) => {
  if (request.url === '/timeout') {
    setTimeout(() => {
      if (response.destroyed) return;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ignored: true }));
    }, 1500);
    return;
  }

  const scenario = scenarios[request.url];
  if (!scenario) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'unknown controlled scenario' }));
    return;
  }

  response.writeHead(scenario.status, {
    'Content-Type': 'application/json',
    ...(scenario.headers ?? {}),
  });
  response.end(JSON.stringify(scenario.body));
});

server.listen(port, host, () => {
  process.stdout.write(`MARK NVIDIA fixture listening on http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
