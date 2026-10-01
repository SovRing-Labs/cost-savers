.PHONY: test

test:
	node --experimental-strip-types --test tests/test_*.mjs
	python3 tests/test_fleet_token_baseline.py
	@echo "All cost-savers tests PASSED."
