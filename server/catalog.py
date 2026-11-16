"""Small JSON bridge to the public YouTube Music catalogue."""

import json
import sys

from ytmusicapi import YTMusic


def track_metadata(track):
    artists = [
        artist["name"] for artist in track.get("artists", []) if artist.get("name")
    ]
    if not track.get("videoId") or not track.get("title") or not artists:
        return None
    return {"videoId": track["videoId"], "title": track["title"], "artists": artists}


def main():
    request = json.load(sys.stdin)
    music = YTMusic()
    if request["operation"] == "search":
        tracks = music.search(request["query"], filter="songs", limit=20)
        result = [metadata for track in tracks if (metadata := track_metadata(track))]
    elif request["operation"] == "playlist":
        playlist = music.get_playlist(request["playlistId"], limit=None)
        tracks = playlist.get("tracks", [])
        usable = [
            metadata for track in tracks
            if track.get("isAvailable", True) and (metadata := track_metadata(track))
        ]
        result = {"title": playlist["title"], "tracks": usable, "skipped": len(tracks) - len(usable)}
    else:
        video_id = request["videoId"]
        tracks = music.get_watch_playlist(videoId=video_id, limit=1).get("tracks", [])
        candidates = [
            candidate
            for track in tracks
            for candidate in (track, track.get("counterpart") or {})
        ]
        result = next(
            (track_metadata(track) for track in candidates if track.get("videoId") == video_id),
            None,
        )
        if not result:
            raise ValueError("No title and artist credits were returned for this song.")
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
