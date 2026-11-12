"""Local bridge from Bandy to OpenAI-compatible AI providers for the instrument designer's AI Assist.

Listens on 127.0.0.1 only, accepts requests only from Bandy origins, and stores no keys or prompts.
Bandy sends the provider's chat-completions `endpoint` along with each request, so any OpenAI-compatible
service works (OpenAI, Anthropic, OpenRouter, Groq, Mistral, DeepSeek, Together, Kilo, Ollama, your own gateway).
"""
import http.server
import json
import urllib.error
import urllib.request
from urllib.parse import urlparse

PORT = 5175
VERSION = 2  # bump when the request format changes (Bandy warns about outdated bridges)
LOCAL_HOSTS = ('localhost', '127.0.0.1', '::1')
MAX_REQUEST = 32000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow redirects: the Authorization header must not leak to another host."""

    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def check_endpoint(raw):
    """Return the endpoint URL if it is acceptable, or raise ValueError."""
    if not isinstance(raw, str) or len(raw) > 500:
        raise ValueError('Invalid endpoint')
    url = urlparse(raw)
    local = url.hostname in LOCAL_HOSTS
    if url.username or url.password or not url.hostname:
        raise ValueError('Invalid endpoint')
    if not (url.scheme == 'https' or (url.scheme == 'http' and local)):
        raise ValueError('Endpoint must use https (http is only allowed for localhost)')
    return raw


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
        self.wfile.write(json.dumps({'ok': True, 'version': VERSION}).encode())

    def do_POST(self):
        if not self.allowed() or self.path != '/generate':
            self.send_error(403)
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size <= 0 or size > MAX_REQUEST:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            key, model, messages = data.get('key') or '', data['model'], data['messages']
            endpoint = check_endpoint(data['endpoint'])
            if not isinstance(key, str) or not isinstance(model, str) or not model or not isinstance(messages, list):
                raise ValueError('Invalid request')
            body = {'model': model, 'messages': messages, 'max_tokens': 4000}
            temp = data.get('temperature')
            if isinstance(temp, (int, float)) and not isinstance(temp, bool):
                body['temperature'] = max(0.0, min(1.2, float(temp)))
            headers = {'Content-Type': 'application/json'}
            if key:
                headers['Authorization'] = 'Bearer ' + key
            req = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers=headers)
            with OPENER.open(req, timeout=90) as response:
                result = response.read(200000)
            self.headers_for(200)
            self.wfile.write(result)
        except urllib.error.HTTPError as exc:
            self.headers_for(exc.code if 400 <= exc.code < 600 else 502)
            self.wfile.write(json.dumps({'error': f'The provider returned HTTP {exc.code}.'}).encode())
        except ValueError as exc:
            self.headers_for(400)
            self.wfile.write(json.dumps({'error': str(exc)}).encode())
        except (KeyError, TypeError, urllib.error.URLError, TimeoutError, OSError):
            self.headers_for(502)
            self.wfile.write(b'{"error":"Could not reach the provider or the request was invalid."}')

    def log_message(self, format, *args):
        pass


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Bandy AI bridge running at http://127.0.0.1:{PORT}. Keep this window open.', flush=True)
    server.serve_forever()
