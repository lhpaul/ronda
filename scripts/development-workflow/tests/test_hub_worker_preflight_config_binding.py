"""Ronda-owned isolating proof for the hub worker preflight config_id binding (#172).

The upstream suite does not isolate the ``config_id`` comparison in the
verifier. This case changes only that field of an otherwise valid, current
result: verification must refuse it, and the unchanged result must pass.
"""
import unittest

import test_hub_worker_preflight as upstream


class ConfigBinding(upstream.WorkerPreflightTests):
    def test_config_binding_isolated(self):
        result, data = self.check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.verify(data)[0].returncode, 0)
        planted = dict(data, config_id="0" * len(data["config_id"]))
        refused, detail = self.verify(planted)
        self.assertEqual(refused.returncode, 1)
        self.assertEqual(detail["check"], "result")
        self.assertEqual(self.verify(data)[0].returncode, 0)


# Run only the isolating case; the inherited upstream cases have their own suite.
for _name in [n for n in dir(upstream.WorkerPreflightTests) if n.startswith("test_")]:
    setattr(ConfigBinding, _name, None)
ConfigBinding.test_config_binding_isolated = ConfigBinding.__dict__["test_config_binding_isolated"]

if __name__ == "__main__":
    unittest.main()
