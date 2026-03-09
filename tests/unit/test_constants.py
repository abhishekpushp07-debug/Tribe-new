"""Unit Tests — constants.js

Tests: assignHouse determinism, HOUSES completeness, ErrorCode completeness
"""
import pytest
from tests.helpers.js_eval import eval_js, eval_js_raw

pytestmark = pytest.mark.unit

CONST = 'import { assignHouse, HOUSES, ErrorCode, Role, ContentKind, Visibility } from "./lib/constants.js";'


class TestAssignHouse:
    def test_deterministic_same_user(self):
        """Same userId always maps to same house."""
        r = eval_js_raw(f"""
{CONST}
const h1 = assignHouse('user-abc-123');
const h2 = assignHouse('user-abc-123');
process.stdout.write(JSON.stringify({{ same: h1.slug === h2.slug, slug: h1.slug }}));
process.exit(0);
""")
        assert r['same'] is True

    def test_different_users_can_differ(self):
        """Different userIds should (probabilistically) map to different houses."""
        r = eval_js_raw(f"""
{CONST}
const slugs = new Set();
for (let i = 0; i < 100; i++) slugs.add(assignHouse('user-' + i).slug);
process.stdout.write(JSON.stringify({{ uniqueHouses: slugs.size }}));
process.exit(0);
""")
        # 100 random users should hit at least 5 different houses out of 12
        assert r['uniqueHouses'] >= 5

    def test_returns_valid_house_object(self):
        r = eval_js(CONST, 'assignHouse("test-user-xyz")')
        assert 'slug' in r
        assert 'name' in r
        assert 'motto' in r
        assert 'color' in r
        assert 'domain' in r
        assert 'icon' in r

    def test_house_index_stays_in_bounds(self):
        """assignHouse never returns undefined (index always valid)."""
        r = eval_js_raw(f"""
{CONST}
let allValid = true;
for (let i = 0; i < 500; i++) {{
    const h = assignHouse('stress-test-' + i + '-' + Math.random());
    if (!h || !h.slug) allValid = false;
}}
process.stdout.write(JSON.stringify({{ allValid }}));
process.exit(0);
""")
        assert r['allValid'] is True


class TestHouses:
    def test_exactly_12_houses(self):
        r = eval_js(CONST, 'HOUSES.length')
        assert r == 12

    def test_all_slugs_unique(self):
        r = eval_js(CONST, '({ slugs: HOUSES.map(h => h.slug), unique: new Set(HOUSES.map(h => h.slug)).size })')
        assert r['unique'] == 12
        assert len(r['slugs']) == 12


class TestErrorCode:
    def test_has_core_codes(self):
        r = eval_js(CONST, 'ErrorCode')
        core = ['VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND',
                'CONFLICT', 'RATE_LIMITED', 'PAYLOAD_TOO_LARGE', 'INTERNAL']
        for code in core:
            assert code in r, f'Missing ErrorCode.{code}'

    def test_has_auth_codes(self):
        r = eval_js(CONST, 'ErrorCode')
        auth = ['AGE_REQUIRED', 'CHILD_RESTRICTED', 'BANNED', 'SUSPENDED']
        for code in auth:
            assert code in r, f'Missing ErrorCode.{code}'

    def test_has_domain_codes(self):
        r = eval_js(CONST, 'ErrorCode')
        domain = ['INVALID_STATE', 'GONE', 'EXPIRED', 'DUPLICATE',
                  'SELF_ACTION', 'LIMIT_EXCEEDED', 'CONTENT_REJECTED']
        for code in domain:
            assert code in r, f'Missing ErrorCode.{code}'


class TestRole:
    def test_role_hierarchy(self):
        r = eval_js(CONST, 'Role')
        assert r['USER'] == 'USER'
        assert r['MODERATOR'] == 'MODERATOR'
        assert r['ADMIN'] == 'ADMIN'
        assert r['SUPER_ADMIN'] == 'SUPER_ADMIN'
