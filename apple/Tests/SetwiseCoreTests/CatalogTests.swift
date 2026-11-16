import Foundation
import Testing

@testable import SetwiseCore

struct CatalogTests {
  @Test func linksRejectUntrustedHostsAndExtractIdentity() throws {
    #expect(try YouTubeLink.video("https://youtu.be/abcdefghijk") == "abcdefghijk")
    #expect(
      try YouTubeLink.playlist("https://music.youtube.com/playlist?list=PLabcdefghijk")
        == "PLabcdefghijk")
    #expect(throws: (any Error).self) {
      try YouTubeLink.video("https://youtube.com.evil.test/watch?v=abcdefghijk")
    }
    #expect(throws: (any Error).self) {
      try YouTubeLink.playlist("https://evil.test/playlist?list=PLabcdefghijk")
    }
  }
  @Test func catalogReadsStructuredArtistsInsteadOfAlbumOrUploader() throws {
    let row = songRow()
    let tracks = CatalogParser.tracks(in: [row, row])
    #expect(tracks.count == 1)
    #expect(tracks.first?.artists == ["First, Artist", "Second Artist"])
    #expect(tracks.first?.title == "Song")
    #expect(CatalogParser.playlistTitle(in: row, id: "OLAKplaylist") == "Album")
    #expect(CatalogParser.playlistTitle(in: row, id: "PLplaylist") == "")
    #expect(
      CatalogParser.continuation(in: ["nextContinuationData": ["continuation": "next-page"]])
        == "next-page")
  }

  @Test func playlistReadsActionContinuationsAndSkipsUnavailableSongs() throws {
    let page: [String: Any] = [
      "onResponseReceivedActions": [
        [
          "appendContinuationItemsAction": [
            "targetId": "PLplaylist",
            "continuationItems": [
              songRow(),
              ["musicResponsiveListItemRenderer": ["flexColumns": []]],
              [
                "continuationItemRenderer": [
                  "continuationEndpoint": ["continuationCommand": ["token": "next-song-page"]]
                ]
              ],
            ],
          ]
        ],
        [
          "appendContinuationItemsAction": [
            "targetId": "recommendations", "continuationItems": [songRow()],
          ]
        ],
      ]
    ]
    let parsed = try CatalogParser.playlistPage(in: page, playlistID: "PLplaylist")
    #expect(parsed.tracks.map(\.videoId) == ["abcdefghijk"])
    #expect(parsed.skipped == 1)
    #expect(parsed.continuation == "next-song-page")
  }

  @Test func playlistSupportsShelfPagesWithoutFollowingRecommendationTokens() throws {
    for renderer in [
      "musicPlaylistShelfRenderer", "musicPlaylistShelfContinuation", "musicShelfContinuation",
    ] {
      let shelf: [String: Any] = [
        "contents": [songRow()],
        "continuations": [["nextContinuationData": ["continuation": "next-song-page"]]],
      ]
      let parsed = try CatalogParser.playlistPage(in: [renderer: shelf], playlistID: "PLplaylist")
      #expect(parsed.tracks.count == 1)
      #expect(parsed.continuation == "next-song-page")
    }
    let finalPage: [String: Any] = [
      "sectionListRenderer": [
        "contents": [["musicPlaylistShelfRenderer": ["contents": [songRow()]]]],
        "continuations": [["nextContinuationData": ["continuation": "related-playlists"]]],
      ]
    ]
    #expect(
      try CatalogParser.playlistPage(in: finalPage, playlistID: "PLplaylist").continuation == nil)
    #expect(throws: (any Error).self) {
      try CatalogParser.playlistPage(in: ["unexpected": []], playlistID: "PLplaylist")
    }
    let empty = try CatalogParser.playlistPage(
      in: ["appendContinuationItemsAction": ["continuationItems": []]], playlistID: "PLplaylist")
    #expect(empty.tracks.isEmpty && empty.continuation == nil)
  }

  private func songRow() -> [String: Any] {
    [
      "musicResponsiveListItemRenderer": [
        "playlistItemData": ["videoId": "abcdefghijk"],
        "flexColumns": [
          ["musicResponsiveListItemFlexColumnRenderer": ["text": ["runs": [["text": "Song"]]]]],
          [
            "musicResponsiveListItemFlexColumnRenderer": [
              "text": [
                "runs": [
                  [
                    "text": "First, Artist",
                    "navigationEndpoint": ["browseEndpoint": ["browseId": "UCfirst"]],
                  ],
                  ["text": " & "],
                  [
                    "text": "Second Artist",
                    "navigationEndpoint": ["browseEndpoint": ["browseId": "UCsecond"]],
                  ],
                  [
                    "text": "Album",
                    "navigationEndpoint": ["browseEndpoint": ["browseId": "MPREalbum"]],
                  ],
                ]
              ]
            ]
          ],
        ],
      ]
    ]
  }
}
