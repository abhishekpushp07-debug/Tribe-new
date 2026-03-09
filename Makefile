# Tribe — Makefile
# Test execution hooks for Stage 4A

.PHONY: test test-unit test-integration test-smoke test-coverage

# Full CI gate (all layers)
test:
	bash scripts/ci-gate.sh

# Individual layers
test-unit:
	python -m pytest tests/unit -v --tb=short -c tests/pytest.ini

test-integration:
	python -m pytest tests/integration -v --tb=short -c tests/pytest.ini

test-smoke:
	python -m pytest tests/smoke -v --tb=short -c tests/pytest.ini

# By marker
test-mark-unit:
	python -m pytest tests/ -v --tb=short -c tests/pytest.ini -m unit

test-mark-integration:
	python -m pytest tests/ -v --tb=short -c tests/pytest.ini -m integration

test-mark-smoke:
	python -m pytest tests/ -v --tb=short -c tests/pytest.ini -m smoke

# Coverage
test-coverage:
	python -m pytest tests/ -v --tb=short -c tests/pytest.ini --cov=tests --cov-report=term-missing --cov-report=html:tests/coverage_html

# Collect only (dry run)
test-collect:
	python -m pytest tests/ --collect-only -c tests/pytest.ini
