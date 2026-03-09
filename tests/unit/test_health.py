"""Unit Tests — health.js

Tests: checkLiveness shape/content
"""
import pytest
from tests.helpers.js_eval import eval_js_raw

pytestmark = pytest.mark.unit


class TestCheckLiveness:
    def test_returns_ok_status(self):
        r = eval_js_raw("""
import { checkLiveness } from './lib/health.js';
const result = await checkLiveness();
process.stdout.write(JSON.stringify(result));
process.exit(0);
""")
        assert r['status'] == 'ok'

    def test_has_uptime(self):
        r = eval_js_raw("""
import { checkLiveness } from './lib/health.js';
const result = await checkLiveness();
process.stdout.write(JSON.stringify(result));
process.exit(0);
""")
        assert 'uptime' in r
        assert isinstance(r['uptime'], (int, float))
        assert r['uptime'] >= 0

    def test_has_iso_timestamp(self):
        r = eval_js_raw("""
import { checkLiveness } from './lib/health.js';
const result = await checkLiveness();
process.stdout.write(JSON.stringify(result));
process.exit(0);
""")
        assert 'timestamp' in r
        # ISO 8601 format check
        ts = r['timestamp']
        assert 'T' in ts
        assert ts.endswith('Z') or '+' in ts

    def test_shape_has_exactly_3_keys(self):
        r = eval_js_raw("""
import { checkLiveness } from './lib/health.js';
const result = await checkLiveness();
process.stdout.write(JSON.stringify({ keys: Object.keys(result).sort() }));
process.exit(0);
""")
        assert sorted(r['keys']) == ['status', 'timestamp', 'uptime']
