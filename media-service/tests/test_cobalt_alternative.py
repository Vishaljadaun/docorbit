import io
import json
from urllib.error import HTTPError
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cobalt_alternative import extract_with_cobalt, is_public_https


class CobaltAlternativeTests(unittest.TestCase):
    def test_rejects_private_destinations(self):
        for url in ("http://media.example.com/file", "https://127.0.0.1/file", "https://192.168.1.10/a", "https://localhost/a", "https://bad.internal/a"):
            self.assertFalse(is_public_https(url),url)
        self.assertTrue(is_public_https("https://docorbit-cobalt-probe.onrender.com/tunnel?id=test"))

    def _mock_response(self, body):
        response=MagicMock()
        response.read.return_value=json.dumps(body).encode()
        response.__enter__.return_value=response
        response.__exit__.return_value=False
        return response

    @patch("cobalt_alternative.urlopen")
    def test_successful_tunnel(self, request):
        request.return_value=self._mock_response({"status":"tunnel","url":"https://docorbit-cobalt-probe.onrender.com/tunnel?id=abc","filename":"clip.mp4"})
        result=extract_with_cobalt("https://www.instagram.com/reel/Example99/", "1080")
        self.assertEqual(result["status"],"tunnel")
        self.assertEqual(result["filename"],"clip.mp4")

    @patch("cobalt_alternative.urlopen")
    def test_error_is_not_reported_as_download(self, request):
        request.return_value=self._mock_response({"status":"error","error":{"code":"api.content.post.unavailable"}})
        result=extract_with_cobalt("https://www.instagram.com/reel/Example99/")
        self.assertEqual(result["status"],"error")
        self.assertNotIn("url",result)

    @patch("cobalt_alternative.urlopen")
    def test_http_400_json_error_preserves_cobalt_reason(self, request):
        body=json.dumps({"status":"error","error":{"code":"error.api.fetch.empty"}}).encode()
        request.side_effect=HTTPError(
            "https://docorbit-cobalt-probe.onrender.com/",400,
            "Bad Request",{},io.BytesIO(body)
        )
        result=extract_with_cobalt("https://www.instagram.com/p/Example99/")
        self.assertEqual(result["status"],"error")
        self.assertEqual(result["code"],"error.api.fetch.empty")
        self.assertIn("cloud servers",result["message"])

    @patch("cobalt_alternative.urlopen")
    def test_http_429_is_reported_as_rate_limit(self, request):
        request.side_effect=HTTPError(
            "https://docorbit-cobalt-probe.onrender.com/",429,
            "Too Many Requests",{},io.BytesIO(b'{}')
        )
        with self.assertRaisesRegex(ValueError,"rate-limiting"):
            extract_with_cobalt("https://www.instagram.com/p/Example99/")

    @patch("cobalt_alternative.urlopen")
    def test_picker_discards_unsafe_links(self, request):
        request.return_value=self._mock_response({"status":"picker","picker":[{"type":"photo","url":"https://cdn.example.com/img.jpg"},{"type":"photo","url":"http://localhost/foo"}]})
        result=extract_with_cobalt("https://www.instagram.com/p/Example99/")
        self.assertEqual(len(result["items"]),1)

    @patch("cobalt_alternative.urlopen")
    def test_tunnel_must_use_own_cobalt_host(self, request):
        request.return_value=self._mock_response({"status":"tunnel","url":"https://unknown.example.com/tunnel","filename":"file.mp4"})
        with self.assertRaisesRegex(ValueError,"unexpected tunnel host"):
            extract_with_cobalt("https://www.instagram.com/p/Example99/")

    def test_quality_restriction(self):
        with self.assertRaises(ValueError):
            extract_with_cobalt("https://www.instagram.com/p/Example99/","4320")


if __name__=="__main__":
    unittest.main()
