"""Regression tests for the single public download endpoint (no network traffic)."""
import asyncio
import os
import shutil
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from fastapi import HTTPException
from starlette.requests import Request
import main


def request():
    return Request({
        "type": "http", "method": "POST", "scheme": "https",
        "path": "/api/media/download", "query_string": b"",
        "headers": [], "client": ("8.8.8.8", 1000),
        "server": ("127.0.0.1", 10000)
    })


class UnifiedDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        main.requests_by_client.clear()
        main.requests_global.clear()

    async def asyncTearDown(self):
        for token, (_, folder, _, _) in list(main.prepared_files.items()):
            main.prepared_files.pop(token, None)
            shutil.rmtree(folder, ignore_errors=True)
        main.requests_by_client.clear()
        main.requests_global.clear()

    @patch("main.inspect_video")
    @patch("main.extract_with_cobalt")
    async def test_streamed_url_wins_without_fetching_media_to_docorbit(self, cobalt, inspect):
        cobalt.return_value = {
            "status": "tunnel",
            "url": "https://docorbit-cobalt-probe.onrender.com/tunnel?id=example",
            "filename": "video.mp4"
        }
        result = await main.download(
            main.DownloadRequest(url="https://www.instagram.com/reel/DfK-gDMTAUG/"), request()
        )
        self.assertEqual(result["status"], "ready")
        self.assertIn("/tunnel", result["url"])
        inspect.assert_not_called()

    async def test_preview_does_not_consume_one_time_photo_download(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            file = folder / "photo.jpg"
            file.write_bytes(bytes.fromhex("ffd8ff") + b"image data" * 20)
            token = "validPreviewToken1234567890123"
            main.prepared_files[token] = (file, folder, "photo.jpg", main.time.monotonic() + 600)
            preview = await main.preview_file(token)
            self.assertEqual(preview.media_type, "image/jpeg")
            self.assertIn("inline", preview.headers.get("content-disposition", ""))
            self.assertIn(token, main.prepared_files)
            file_response = await main.get_file(token)
            self.assertIsNotNone(file_response)
            self.assertNotIn(token, main.prepared_files)

    @patch("main.extract_with_cobalt")
    async def test_cobalt_video_returns_preview_url_for_player(self, cobalt):
        cobalt.return_value = {
            "status": "tunnel",
            "url": "https://docorbit-cobalt-probe.onrender.com/tunnel?id=preview",
            "filename": "clip.mp4",
        }
        response = await main.download(
            main.DownloadRequest(url="https://www.instagram.com/reel/DfK-gDMTAUG/"), request()
        )
        self.assertEqual(response["mediaType"], "video")
        self.assertEqual(response["previewUrl"], response["url"])

    @patch("main.inspect_video")
    @patch("main.extract_with_cobalt")
    async def test_picker_has_multiple_media_items(self, cobalt, inspect):
        cobalt.return_value = {
            "status": "picker",
            "items": [{"url": "https://example.com/1.jpg", "type": "photo"}]
        }
        result = await main.download(
            main.DownloadRequest(url="https://www.instagram.com/p/De8-ux4MRVs/"), request()
        )
        self.assertEqual(result["status"], "picker")
        self.assertEqual(len(result["items"]), 1)
        inspect.assert_not_called()

    @patch("main.save_video")
    @patch("main.inspect_video")
    @patch("main.extract_with_cobalt")
    async def test_download_falls_back_to_temp_file_after_failed_direct_provider(self, cobalt, inspect, save):
        cobalt.return_value = {"status": "error", "code": "error.api.fetch.empty"}
        inspect.return_value = {"mediaType": "video", "duration": 12}
        def create_file(url, quality, folder):
            path = folder / "docorbit.mp4"
            path.write_bytes(b"test only, no external media downloaded")
            return path, "clip.mp4"
        save.side_effect = create_file
        result = await main.download(
            main.DownloadRequest(url="https://www.instagram.com/reel/DfK-gDMTAUG/"), request()
        )
        self.assertEqual(result["status"], "ready")
        self.assertRegex(result["url"], r"^/api/media/file/[A-Za-z0-9_-]+$")
        self.assertEqual(result["filename"], "clip.mp4")

    @patch("main.save_public_photo")
    @patch("main.inspect_video")
    @patch("main.extract_with_cobalt")
    async def test_same_download_button_saves_instagram_photo(self, cobalt, inspect, save_photo):
        cobalt.return_value = {"status": "error", "code": "error.api.fetch.empty"}
        inspect.return_value = {"mediaType": "photo", "downloadMethod": "direct_photo", "itemCount": 1}
        def save_image(url, folder):
            path = folder / "instagram-De8-ux4MRVs.jpg"
            path.write_bytes(b"test JPEG fixture")
            return path, path.name
        save_photo.side_effect = save_image
        result = await main.download(
            main.DownloadRequest(
                url="https://www.instagram.com/p/De8-ux4MRVs/?utm_source=ig_web_copy_link&cplk=NTc4MTIwNjQ2YQ=="
            ), request()
        )
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["filename"], "instagram-De8-ux4MRVs.jpg")
        self.assertRegex(result["url"], r"^/api/media/file/[A-Za-z0-9_-]+$")
        save_photo.assert_called_once()

    @patch("main.save_public_photo")
    @patch("main.inspect_video")
    @patch("main.extract_with_cobalt")
    async def test_prepared_photo_returns_distinct_inline_preview_link(self, cobalt, inspect, save):
        cobalt.return_value = {"status": "error"}
        inspect.return_value = {"downloadMethod": "direct_photo"}
        def save_image(url, folder):
            path = folder / "picture.jpg"
            path.write_bytes(bytes.fromhex("ffd8ff") + b"mock image" * 20)
            return path, path.name
        save.side_effect = save_image
        response = await main.download(
            main.DownloadRequest(url="https://www.instagram.com/p/De8-ux4MRVs/"), request()
        )
        self.assertEqual(response["mediaType"], "photo")
        self.assertTrue(response["previewUrl"].startswith("/api/media/preview/"))
        self.assertTrue(response["url"].startswith("/api/media/file/"))
        self.assertNotEqual(response["previewUrl"], response["url"])

    @patch("main.inspect_video")
    @patch("main.extract_with_cobalt")
    async def test_both_fail_with_simple_user_facing_error(self, cobalt, inspect):
        cobalt.return_value = {"status": "error", "code": "error.api.fetch.empty"}
        inspect.side_effect = ValueError("Login required")
        with self.assertRaises(HTTPException) as context:
            await main.download(
                main.DownloadRequest(url="https://www.instagram.com/p/De8-ux4MRVs/"), request()
            )
        self.assertEqual(context.exception.status_code, 422)
        self.assertIn("could not be downloaded", context.exception.detail.lower())
        self.assertNotIn("Cobalt", context.exception.detail)

    @patch("main.extract_with_cobalt")
    async def test_bad_domain_is_rejected_before_any_extraction(self, cobalt):
        with self.assertRaises(HTTPException) as context:
            await main.download(
                main.DownloadRequest(url="https://localhost.invalid/p/De8-ux4MRVs/"), request()
            )
        self.assertEqual(context.exception.status_code, 422)
        cobalt.assert_not_called()


if __name__ == "__main__":
    unittest.main()
