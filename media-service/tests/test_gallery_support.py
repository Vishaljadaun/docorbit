import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gallery_support import is_photo_fallback, inspect_gallery, save_gallery


class InstagramPhotoFallbackTests(unittest.TestCase):
    def test_only_public_instagram_posts_with_no_video_use_fallback(self):
        message = "ERROR: [Instagram] De8-ux4MRVs: There is no video in this post"
        self.assertTrue(is_photo_fallback("https://www.instagram.com/p/De8-ux4MRVs/", message))
        self.assertTrue(is_photo_fallback("https://www.instagram.com/reel/De8-ux4MRVs/", "No video formats found!"))
        self.assertFalse(is_photo_fallback("https://youtube.com/watch?v=abcdefghijk", message))
        self.assertFalse(is_photo_fallback("https://instagram.com.evil.example/p/De8-ux4MRVs/", message))
        self.assertFalse(is_photo_fallback("https://instagram.com/p/De8-ux4MRVs/", "Sign in to see this content"))

    @patch("gallery_support._run")
    def test_photo_probe_uses_image_links_and_removes_tracking(self, run):
        run.return_value = subprocess.CompletedProcess(
            [], 0, "https://scontent.cdn.example/img-a.jpg\nhttps://scontent.cdn.example/img-b.jpg\n", ""
        )
        result = inspect_gallery("https://www.instagram.com/p/De8-ux4MRVs/?utm_source=ig_web_copy_link")
        self.assertEqual(result["mediaType"], "photo")
        self.assertEqual(result["itemCount"], 2)
        command = run.call_args.args[0]
        self.assertNotIn("utm_source", " ".join(command))
        self.assertIn("--get-urls", command)
        self.assertIn("--no-input", command)

    @patch("gallery_support._run")
    def test_photo_probe_reports_inaccessible_media(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, "", "This post requires login")
        with self.assertRaisesRegex(ValueError, "not accessible"):
            inspect_gallery("https://www.instagram.com/p/De8-ux4MRVs/")

    @patch("gallery_support._run")
    def test_single_photo_is_downloaded_individually(self, run):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            def fake_download(args, timeout):
                (folder / "original.jpg").write_bytes(b"fake jpg test fixture")
                return subprocess.CompletedProcess(args, 0, "", "")
            run.side_effect = fake_download
            path, name = save_gallery("https://instagram.com/p/De8-ux4MRVs/", folder)
            self.assertEqual(name, "instagram-post.jpg")
            self.assertTrue(path.is_file())

    @patch("gallery_support._run")
    def test_carousel_produces_zip(self, run):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            def fake_download(args, timeout):
                (folder / "one.jpg").write_bytes(b"image one")
                (folder / "two.png").write_bytes(b"image two")
                return subprocess.CompletedProcess(args, 0, "", "")
            run.side_effect = fake_download
            path, name = save_gallery("https://instagram.com/p/De8-ux4MRVs/", folder)
            self.assertEqual(name, "instagram-post.zip")
            from zipfile import ZipFile
            with ZipFile(path) as z:
                self.assertEqual(len(z.namelist()), 2)


if __name__ == "__main__":
    unittest.main()
