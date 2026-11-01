import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from main import classify_link, basic_options, inspect_video, safe_error
from yt_dlp import DownloadError

class MediaServiceValidationTests(unittest.TestCase):
    def test_supported_public_posts(self):
        examples = {
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ": "YouTube",
            "https://youtu.be/dQw4w9WgXcQ": "YouTube",
            "https://youtube.com/shorts/dQw4w9WgXcQ": "YouTube",
            "https://www.instagram.com/reel/Cxxxyyyzzz/": "Instagram",
            "https://x.com/artist/status/1234567890123456789": "X",
            "https://twitter.com/artist/status/1234567890123456789": "X",
            "https://www.threads.net/@artist/post/AbCdEf0123": "Threads",
        }
        for url, expected in examples.items():
            with self.subTest(url=url):
                self.assertEqual(classify_link(url), expected)

    def test_rejects_unsupported_or_unsafe_sources(self):
        rejected = [
            "http://youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtube.com.bad.example/watch?v=dQw4w9WgXcQ",
            "https://localhost:8443/status/123456",
            "https://127.0.0.1/secret",
            "https://user:password@youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/playlist?list=PL123456789",
            "https://www.instagram.com/accounts/login/",
            "file:///etc/passwd",
        ]
        for url in rejected:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    classify_link(url)

    def test_download_options_forbid_playlists_and_local_cache(self):
        options = basic_options()
        self.assertTrue(options["noplaylist"])
        self.assertFalse(options["cachedir"])
        self.assertTrue(options["skip_download"])
        self.assertLessEqual(options["socket_timeout"], 20)


class GalleryFallbackRoutingTests(unittest.TestCase):
    @patch("main.inspect_gallery")
    @patch("main.YoutubeDL")
    def test_ytdlp_no_video_error_uses_public_image_fallback(self, downloader, gallery):
        downloader.return_value.__enter__.return_value.extract_info.side_effect = DownloadError(
            "ERROR: [Instagram] De8-ux4MRVs: There is no video in this post"
        )
        gallery.return_value = {
            "mediaType": "photo", "downloadMethod": "gallery",
            "itemCount": 1, "title": "Instagram photo post",
        }
        result = inspect_video("https://www.instagram.com/p/De8-ux4MRVs/?utm_source=ig_web_copy_link&cplk=NTc4MTIwNjQ2YQ==")
        self.assertEqual(result["downloadMethod"], "direct_photo")
        self.assertEqual(result["mediaType"], "photo")
        gallery.assert_not_called()

    def test_youtube_bot_block_is_not_misreported_as_missing_video(self):
        error = safe_error(DownloadError("Sign in to confirm you're not a bot"))
        self.assertEqual(error.status_code, 422)
        self.assertIn("YouTube", error.detail)


if __name__ == "__main__":
    unittest.main()
