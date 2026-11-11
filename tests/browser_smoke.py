"""Real Chromium checks with an in-memory GitHub API; never writes to GitHub.
Start npm run dev, then run npm run test:browser.
Requires Python Playwright and Chromium (CHROMIUM_PATH may override the executable).
"""
import base64
import copy
import json
import os
import pathlib
from datetime import date, timedelta
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

ROOT = pathlib.Path(__file__).resolve().parents[1]
URL = os.environ.get('TEST_URL', 'http://127.0.0.1:4173/plant-diary/')
TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()
PHOTO = ROOT / 'assets' / 'plant-hero.jpg'

def document(entries):
    return {'schemaVersion': 1, 'entries': entries}

def encode(data):
    return base64.b64encode(json.dumps(data, ensure_ascii=False).encode()).decode()

class GitHub:
    def __init__(self):
        self.entries = {}
        self.head = 'initial'
        self.snapshots = {self.head: {}}
        self.blobs = {}
        self.trees = {}
        self.commits = {}
        self.writes = []
        self.read_error = False
        self.write_error = False
        self.permission = True
        self.counter = 0

    def install(self, context):
        context.route('https://api.github.com/**', self.handle)
        context.route('**/photos/**', lambda r: r.fulfill(status=200, content_type='image/jpeg', body=PHOTO.read_bytes()))

    def handle(self, route):
        request = route.request
        url = urlparse(request.url)
        path = url.path.replace('/repos/Ilikectrlmusic/plant-diary', '')
        body = request.post_data_json if request.method in ('POST', 'PUT', 'PATCH') else None
        if request.method != 'GET':
            self.writes.append((path, body))
            if self.write_error:
                route.fulfill(status=403, json={'message': 'simulated permission error'})
                return
        if path == '':
            route.fulfill(status=200, json={'permissions': {'push': self.permission}})
        elif path == '/contents/data/diary.json':
            if self.read_error:
                route.fulfill(status=503, json={'message': 'simulated outage'})
                return
            ref = parse_qs(url.query).get('ref', ['main'])[0]
            entries = self.entries if ref == 'main' else self.snapshots[ref]
            route.fulfill(status=200, json={'sha': 'data-' + self.head, 'encoding': 'base64', 'content': encode(document(entries))})
        elif path == '/git/ref/heads/main':
            route.fulfill(status=200, json={'object': {'sha': self.head}})
        elif path.startswith('/git/commits/'):
            route.fulfill(status=200, json={'tree': {'sha': 'base-tree'}})
        elif path == '/git/blobs':
            self.counter += 1
            sha = f'blob-{self.counter}'
            self.blobs[sha] = base64.b64decode(body['content'])
            route.fulfill(status=201, json={'sha': sha})
        elif path == '/git/trees':
            self.counter += 1
            sha = f'tree-{self.counter}'
            data_blob = next(item['sha'] for item in body['tree'] if item['path'] == 'data/diary.json')
            self.trees[sha] = json.loads(self.blobs[data_blob])['entries']
            route.fulfill(status=201, json={'sha': sha})
        elif path == '/git/commits':
            self.counter += 1
            sha = f'commit-{self.counter}'
            self.commits[sha] = self.trees[body['tree']]
            route.fulfill(status=201, json={'sha': sha})
        elif path == '/git/refs/heads/main':
            assert body['force'] is False
            self.head = body['sha']
            self.entries = copy.deepcopy(self.commits[self.head])
            self.snapshots[self.head] = copy.deepcopy(self.entries)
            route.fulfill(status=200, json={'object': {'sha': self.head}})
        else:
            raise AssertionError(f'Unhandled API request: {request.method} {path}')

    def external_edit(self, key, note):
        self.entries[key]['note'] = note
        self.head = f'external-{self.counter}'
        self.snapshots[self.head] = copy.deepcopy(self.entries)


def connected(page):
    page.locator('#connection-button').click()
    page.locator('#github-token').fill('github_pat_browser_test_only')
    page.locator('#confirm-connect').click()
    expect(page.locator('#connect-dialog')).not_to_be_visible()
    expect(page.locator('#connection-label')).to_have_text('已连接 GitHub')


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True, args=['--no-sandbox'])
        api = GitHub()
        context = browser.new_context(viewport={'width': 1440, 'height': 1050})
        api.install(context)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        expect(page.locator('#load-status')).to_contain_text('已读取云端最新记录')
        expect(page.locator('#total-count')).to_have_text('0')
        expect(page.locator('#empty-month')).to_be_visible()
        assert page.locator('.day').count() in (28, 35, 42)
        print('PASS empty calendar and latest cloud load')

        page.locator('#prev-month').click()
        assert page.locator('#month-picker').input_value() != TODAY[:7]
        page.locator('#today-button').click()
        assert page.locator('#month-picker').input_value() == TODAY[:7]
        page.locator('#month-picker').fill('2024-02')
        page.locator('#month-picker').dispatch_event('change')
        assert page.locator('[data-date="2024-02-29"]').count() == 1
        page.locator('#today-button').click()
        page.locator(f'[data-date="{TODAY}"]').focus()
        page.keyboard.press('ArrowLeft')
        assert page.evaluate('document.activeElement.dataset.date') == YESTERDAY
        print('PASS month picker, leap year, today and keyboard navigation')

        page.locator('#write-today').click()
        page.locator('#save-button').click()
        expect(page.locator('#editor-status')).to_contain_text('先选一张')
        page.locator('#photo-input').set_input_files(str(PHOTO))
        expect(page.locator('#editor-status')).to_contain_text('照片已准备好')
        page.locator('#entry-title').fill('窗边的新叶')
        page.locator('#entry-note').fill('慢慢来，今天也在生长。\n一片新叶，一份新的期待。🌿')
        page.locator('#save-button').click()
        expect(page.locator('#connect-dialog')).to_be_visible()
        page.locator('#github-token').fill('github_pat_browser_test_only')
        page.locator('#confirm-connect').click()
        expect(page.locator('#entry-dialog')).not_to_be_visible()
        expect(page.locator('#total-count')).to_have_text('1')
        assert api.entries[TODAY]['title'] == '窗边的新叶'
        assert len(api.blobs) == 3  # full photo, thumbnail, JSON
        assert context.pages[0].evaluate("localStorage.getItem('plant-diary:github-token')") is None
        assert context.pages[0].evaluate("sessionStorage.getItem('plant-diary:github-token')") == 'github_pat_browser_test_only'
        assert all('browser_test_only' not in json.dumps(v) for _, v in api.writes)
        expect(page.locator(f'[data-date="{TODAY}"] img')).to_be_visible()
        page.locator(f'[data-date="{TODAY}"]').click()
        expect(page.locator('#detail-title')).to_have_text('窗边的新叶')
        expect(page.locator('#detail-content .note')).to_contain_text('🌿')
        assert page.locator('.detail-photo').evaluate('(img) => img.complete && img.naturalWidth > 0')
        assert page.locator('.detail-photo').evaluate('(img) => new URL(img.src).origin === location.origin')
        assert page.locator('.day-photo').first.evaluate('(img) => new URL(img.src).origin === location.origin')
        print('PASS upload, automatic connection, atomic save, Unicode detail and session-only token')

        # A separate browser context sees the cloud entry without sharing a token.
        reader_context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        api.install(reader_context)
        mobile = reader_context.new_page()
        mobile.on('pageerror', lambda e: errors.append(str(e)))
        mobile.goto(URL)
        expect(mobile.locator('#total-count')).to_have_text('1')
        for width in (320, 360, 390, 768, 1024):
            mobile.set_viewport_size({'width': width, 'height': 844})
            assert not mobile.evaluate('document.documentElement.scrollWidth > innerWidth'), f'overflow at {width}'
        mobile.set_viewport_size({'width': 390, 'height': 844})
        mobile.locator(f'[data-date="{TODAY}"]').click()
        expect(mobile.locator('#detail-title')).to_have_text('窗边的新叶')
        mobile.locator('[data-close="detail-dialog"]').click()
        mobile.locator('#write-today').click()
        expect(mobile.locator('#photo-preview')).to_be_visible()
        assert not mobile.locator('#entry-dialog').evaluate('(d) => d.scrollWidth > d.clientWidth')
        mobile.locator('[data-close="entry-dialog"]').first.click()
        print('PASS cross-device read and responsive layouts at 320 / 360 / 390 / 768 / 1024 px')

        page.locator('#edit-entry').click()
        page.locator('#entry-note').fill('我的修改仍在这里')
        api.external_edit(TODAY, '另一台设备刚写下的感想')
        before = len(api.writes)
        page.locator('#save-button').click()
        expect(page.locator('#editor-status')).to_contain_text('其他设备更新')
        expect(page.locator('#entry-note')).to_have_value('我的修改仍在这里')
        assert len(api.writes) == before
        page.locator('#view-cloud').click()
        expect(page.locator('#detail-content .note')).to_have_text('另一台设备刚写下的感想')
        page.locator('[data-close="detail-dialog"]').click()
        page.locator('#use-cloud').click()
        page.locator('#confirm-yes').click()
        expect(page.locator('#entry-note')).to_have_value('另一台设备刚写下的感想')
        print('PASS conflict preserves draft, shows cloud version and reloads only after confirmation')

        page.locator('#entry-note').fill('网络失败时也应保留')
        api.write_error = True
        page.locator('#save-button').click()
        expect(page.locator('#editor-status')).to_contain_text('拒绝')
        expect(page.locator('#entry-dialog')).to_be_visible()
        expect(page.locator('#entry-note')).to_have_value('网络失败时也应保留')
        api.write_error = False
        # A 403 marks the connection unverified; reconnect and retry.
        page.locator('#save-button').click()
        expect(page.locator('#connect-dialog')).to_be_visible()
        page.locator('#github-token').fill('github_pat_browser_test_only')
        page.locator('#confirm-connect').click()
        expect(page.locator('#entry-dialog')).not_to_be_visible()
        assert api.entries[TODAY]['note'] == '网络失败时也应保留'
        print('PASS denied save preserves draft and supports reconnect + successful retry')

        page.locator('#write-today').click()
        page.locator('#entry-date').fill(YESTERDAY)
        page.locator('#entry-date').dispatch_event('change')
        page.locator('#photo-input').set_input_files(str(PHOTO))
        expect(page.locator('#editor-status')).to_contain_text('照片已准备好')
        page.locator('#entry-title').fill('<img src=x onerror=alert(1)>')
        page.locator('#entry-note').fill('<script>alert(1)</script>')
        page.locator('#save-button').click()
        expect(page.locator('#entry-dialog')).not_to_be_visible()
        assert len(api.entries) == 2
        page.locator(f'[data-date="{YESTERDAY}"]').click()
        expect(page.locator('#detail-title')).to_have_text('<img src=x onerror=alert(1)>')
        assert page.locator('#detail-content script').count() == 0
        page.locator('#next-entry').click()
        expect(page.locator('#detail-title')).to_have_text('窗边的新叶')
        page.locator('#delete-entry').click()
        page.locator('#confirm-no').click()
        assert len(api.entries) == 2
        page.locator('#delete-entry').click()
        page.locator('#confirm-yes').click()
        expect(page.locator('#detail-dialog')).not_to_be_visible()
        assert TODAY not in api.entries and YESTERDAY in api.entries
        print('PASS backdating, literal untrusted text, entry navigation and confirmed deletion')

        page.locator('#write-today').click()
        page.locator('#entry-note').fill('还没保存')
        page.keyboard.press('Escape')
        expect(page.locator('#confirm-dialog')).to_be_visible()
        page.locator('#confirm-no').click()
        expect(page.locator('#entry-dialog')).to_be_visible()
        page.keyboard.press('Escape')
        page.locator('#confirm-yes').click()
        expect(page.locator('#entry-dialog')).not_to_be_visible()
        page.locator('#connection-button').click()
        page.locator('#disconnect-button').click()
        assert page.evaluate("sessionStorage.getItem('plant-diary:github-token')") is None
        print('PASS unsaved draft guard and disconnect clearing stored token')

        api.read_error = True
        page.locator('#refresh-button').click()
        expect(page.locator('#load-status')).to_contain_text('已发布版本')
        assert page.locator('#load-status').get_attribute('class') == 'warning'
        # Both sources failing must retain known data, not invent empty data.
        page.route('**/data/diary.json', lambda r: r.fulfill(status=503, body='offline'))
        page.locator('#refresh-button').click()
        expect(page.locator('#load-status')).to_contain_text('刷新失败')
        print('PASS published fallback is labeled and total read failure is explicit')
        assert not errors, errors
        print('PASS no uncaught browser errors')
        browser.close()

if __name__ == '__main__':
    run()
