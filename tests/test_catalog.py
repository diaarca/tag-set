import io
import json
import unittest
from unittest.mock import patch

from server.catalog import main


TRACK = {
    "videoId": "abcdefghijk",
    "title": "A collaboration",
    "artists": [{"name": "First Artist"}, {"name": "Second Artist"}],
}


class CatalogBridgeTests(unittest.TestCase):
    def run_bridge(self, request, *, search=None, tracks=None):
        output = io.StringIO()
        with patch("server.catalog.YTMusic") as factory:
            factory.return_value.search.return_value = search or []
            factory.return_value.get_watch_playlist.return_value = {"tracks": tracks or []}
            with patch("sys.stdin", io.StringIO(json.dumps(request))), patch("sys.stdout", output):
                main()
            return json.loads(output.getvalue()), factory.return_value

    def test_search_preserves_structured_artist_names(self):
        result, client = self.run_bridge({"operation": "search", "query": "collaboration"}, search=[TRACK])
        self.assertEqual(result[0]["artists"], ["First Artist", "Second Artist"])
        self.assertEqual(result[0]["title"], TRACK["title"])
        client.search.assert_called_once_with("collaboration", filter="songs", limit=20)

    def test_lookup_selects_requested_track_instead_of_radio_suggestions(self):
        unrelated = {**TRACK, "videoId": "unrelated12", "counterpart": None}
        result, _ = self.run_bridge({"operation": "lookup", "videoId": TRACK["videoId"]}, tracks=[unrelated, TRACK])
        self.assertEqual(result["videoId"], TRACK["videoId"])
        with self.assertRaises(ValueError):
            self.run_bridge({"operation": "lookup", "videoId": TRACK["videoId"]}, tracks=[unrelated])

    def test_lookup_accepts_matching_video_counterpart(self):
        result, _ = self.run_bridge({"operation": "lookup", "videoId": TRACK["videoId"]}, tracks=[{**TRACK, "videoId": "alternate12", "counterpart": TRACK}])
        self.assertEqual(result["videoId"], TRACK["videoId"])
        self.assertEqual(result["artists"], ["First Artist", "Second Artist"])

    def test_missing_artist_credits_are_not_replaced_with_channel_names(self):
        result, _ = self.run_bridge({"operation": "search", "query": "unknown"}, search=[{**TRACK, "artists": [], "author": "Uploader"}])
        self.assertEqual(result, [])


if __name__ == "__main__":
    unittest.main()
