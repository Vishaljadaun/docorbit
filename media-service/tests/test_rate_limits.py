import os
import sys
import unittest
from collections import defaultdict, deque

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import main
from fastapi import HTTPException
from starlette.requests import Request


def fake_request(ip="8.8.8.8", forwarded="1.1.1.1, 8.8.8.8"):
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({
        "type": "http", "method": "POST", "scheme": "https",
        "path": "/api/media/alternative", "query_string": b"",
        "headers": headers, "client": (ip, 50900), "server": ("localhost", 10000),
    })


class MediaLimitTests(unittest.TestCase):
    def setUp(self):
        main.requests_by_client.clear()
        main.requests_global.clear()

    def tearDown(self):
        main.requests_by_client.clear()
        main.requests_global.clear()

    def test_actual_user_ip_from_reverse_proxy_not_shared_internal_proxy(self):
        request = fake_request(ip="10.10.5.9", forwarded="1.1.1.1, 8.8.8.8")
        self.assertEqual(main._client_identity(request), "8.8.8.8")

    def test_proxy_identity_falls_back_if_forwarded_is_invalid(self):
        self.assertEqual(main._client_identity(fake_request(ip="10.0.0.5", forwarded="nonsense")), "10.0.0.5")

    def test_alternative_and_preparation_use_separate_limit_buckets(self):
        request=fake_request()
        for _ in range(4):
            main.rate_check(request, mode="prepare")
        with self.assertRaises(HTTPException) as blocked:
            main.rate_check(request, mode="prepare")
        self.assertEqual(blocked.exception.status_code,429)
        for _ in range(6):
            main.rate_check(request, mode="alternative")
        with self.assertRaises(HTTPException) as blocked:
            main.rate_check(request, mode="alternative")
        self.assertEqual(blocked.exception.status_code,429)

    def test_different_clients_do_not_share_personal_quota(self):
        for _ in range(6):
            main.rate_check(fake_request(forwarded="8.8.8.8"), mode="alternative")
        main.rate_check(fake_request(forwarded="1.1.1.1"), mode="alternative")

    def test_unknown_operation_rejected(self):
        with self.assertRaisesRegex(ValueError,"Unknown media operation"):
            main.rate_check(fake_request(), mode="unexpected")


if __name__=="__main__":
    unittest.main()
