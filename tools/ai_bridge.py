"""Local bridge from Bandy to OpenAI / Kilo for the instrument designer's AI Assist.

Listens on 127.0.0.1 only, accepts requests only from Bandy origins, and stores no keys or prompts.
"""
import http.server
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse

PORT = 5175
ENDPOINTS = {
    'openai': 'https://api.openai.com/v1/chat/completions',
    'kilo': 'https://ai-gateway.kilo.ai/api/v1/chat/completions',
}


class Handler(http.server.BaseHTTPRequestHandler):
    def allowed(self):
        origin = self.headers.get('Origin', '')
        url = urlparse(origin)
        return (self.headers.get('Host') == f'127.0.0.1:{PORT}' and
                (origin == 'https://ahpah-dev.github.io' or
                 (url.scheme == 'http' and url.hostname in ('127.0.0.1', 'localhost') and url.port in (5173, 5174))))

    def headers_for(self, code):
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', self.headers.get('Origin', ''))
        self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()

    def do_OPTIONS(self):
        self.headers_for(204 if self.allowed() and self.path in ('/generate', '/health') else 403)

    def do_GET(self):
        # Lets the designer show a "Bridge online" indicator.
        if not self.allowed() or self.path != '/health':
            self.send_error(403)
            return
        self.headers_for(200)
        self.wfile.write(b'{"ok":true}')

    def do_POST(self):
        if not self.allowed() or self.path != '/generate':
            self.send_error(403)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > 16000:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            key, model, messages = data.get('key', ''), data['model'], data['messages']
            endpoint = ENDPOINTS[data.get('provider', 'openai')]
            if not isinstance(key, str) or not key or not isinstance(model, str) or not isinstance(messages, list):
                raise ValueError('Invalid request')
            body = {'model': model, 'messages': messages, 'max_tokens': 4000}
            temp = data.get('temperature')
            if isinstance(temp, (int, float)) and not isinstance(temp, bool):
                body['temperature'] = max(0.0, min(1.2, float(temp)))
            payload = json.dumps(body).encode()
            headers = {'Content-Type': 'application/json'}
            if key:
                headers['Authorization'] = 'Bearer ' + key
            req = urllib.request.Request(endpoint, data=payload, headers=headers)
            with urllib.request.urlopen(req, timeout=90) as response:
                result = response.read(100000)
            self.headers_for(200)
            self.wfile.write(result)
        except urllib.error.HTTPError as exc:
            self.headers_for(exc.code)
            self.wfile.write(json.dumps({'error': f'The provider returned HTTP {exc.code}.'}).encode())
        except (ValueError, KeyError, TypeError, urllib.error.URLError, TimeoutError):
            self.headers_for(502)
            self.wfile.write(b'{"error":"Could not reach the provider or the request was invalid."}')

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Bandy AI bridge running at http://127.0.0.1:{PORT}. Keep this window open.', flush=True)
    server.serve_forever()
