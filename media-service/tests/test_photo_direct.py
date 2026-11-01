"""Tests for the bounded, anonymous Instagram single-image endpoint."""
from __future__ import annotations

import os
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from photo_direct import (
    MAX_PHOTO_BYTES, _approved_media_url, photo_shortcode,
    save_public_photo, _ImageOnlyRedirects,
)


class DirectPhotoTests(unittest.TestCase):
    def test_exact_shared_post_with_tracking_is_allowed(self):
        shared = (
            "https://www.instagram.com/p/De8-ux4MRVs/"
            "?utm_source=ig_web_copy_link&cplk=NTc4MTIwNjQ2YQ=="
        )
        self.assertEqual(photo_shortcode(shared), "De8-ux4MRVs")

    def test_other_hosts_or_unsafe_links_rejected(self):
        invalid = [
            "http://www.instagram.com/p/De8-ux4MRVs/",
            "https://www.instagram.com.evil.net/p/De8-ux4MRVs/",
            "https://127.0.0.1/p/De8-ux4MRVs/",
            "https://www.instagram.com/reel/De8-ux4MRVs/",
            "https://evil@www.instagram.com/p/De8-ux4MRVs/",
            "https://www.instagram.com:8443/p/De8-ux4MRVs/",
            "https://www.instagram.com/p/../../admin/",
        ]
        for link in invalid:
            with self.subTest(link=link), self.assertRaises(ValueError):
                photo_shortcode(link)

    def test_redirects_limited_to_instagram_cdn(self):
        self.assertTrue(_approved_media_url(
            "https://scontent-iad3-1.cdninstagram.com/v/t51.2885-15/example.jpg"
        ))
        self.assertFalse(_approved_media_url(
            "https://attacker.example.com/content.jpg"
        ))
        self.assertFalse(_approved_media_url(
            "http://www.instagram.com/p/De8-ux4MRVs/media/"
        ))

    @patch("photo_direct.build_opener")
    def test_saves_real_jpeg_bytes_not_an_html_login_page(self, make_opener):
        body = bytes([0xFF, 0xD8, 0xFF]) + b"valid mock jpeg body" * 20
        response = MagicMock()
        response.url = "https://scontent-iad3-1.cdninstagram.com/image.jpg"
        response.headers = {"Content-Type": "image/jpeg", "Content-Length": str(len(body))}
        response.read.return_value = body
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        make_opener.return_value.open.return_value = response
        with tempfile.TemporaryDirectory() as tmp:
            url = "https://www.instagram.com/p/De8-ux4MRVs/?utm_source=ig_web_copy_link"
            path, name = save_public_photo(url, Path(tmp))
            self.assertEqual(name, "instagram-De8-ux4MRVs.jpg")
            self.assertEqual(path.read_bytes(), body)
        request = make_opener.return_value.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://www.instagram.com/p/De8-ux4MRVs/media/?size=l")
        self.assertEqual(make_opener.return_value.open.call_args.kwargs["timeout"], 16)

    @patch("photo_direct.build_opener")
    def test_rejects_html_login_response(self, make_opener):
        response = MagicMock()
        response.url = "https://www.instagram.com/accounts/login/"
        response.headers = {"Content-Type": "text/html"}
        response.read.return_value = b"<html>login</html>"
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        make_opener.return_value.open.return_value = response
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "not return a public image"):
                save_public_photo("https://www.instagram.com/p/De8-ux4MRVs/", Path(tmp))

    @patch("photo_direct.build_opener")
    def test_rejects_oversized_photo(self, make_opener):
        response = MagicMock()
        response.url = "https://scontent-iad3-1.cdninstagram.com/photo.jpg"
        response.headers = {"Content-Type": "image/jpeg", "Content-Length": str(MAX_PHOTO_BYTES + 1)}
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        make_opener.return_value.open.return_value = response
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, "size limit"):
                save_public_photo("https://www.instagram.com/p/De8-ux4MRVs/", Path(tmp))


if __name__ == "__main__":
    unittest.main()
