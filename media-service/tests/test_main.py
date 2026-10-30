import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from main import classify_link, basic_options

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

if __name__ == "__main__":
    unittest.main()
