# Wise Owl Entertainment — Feature Backlog

## Sprint 1: UI Polish (Current)

- [x] A1: Colored gradient placeholder cards with full channel name
- [x] B2: Collapsible/minimized player until something is playing
- [x] C3: List/grid toggle button for channel views
- [x] D3: Favorites + recent section at top of home
- [x] E1: "Now Playing" mini bar at bottom (Spotify-style)
- [x] E3: Skeleton loading cards while channels load

## Sprint 2: Series Follow + Auto-Play

- [ ] "Follow" button on series (subscribes to new episodes)
- [ ] Auto-cache all episodes of followed series in background
- [ ] Auto-play next episode when current ends
- [ ] Track watch progress (resume from where you fell asleep)
- [ ] Mark episode as "watched" when >90% complete
- [ ] Auto-delete watched episodes after X days (configurable)
- [ ] Sleep timer (stop after X episodes or X minutes)

## Sprint 3: Favorites + Ratings

- [ ] Favorite live channels (heart icon, persisted)
- [ ] Favorite series (follow = auto-favorite)
- [ ] Favorite movies (watchlist)
- [ ] TMDB API integration (ratings, posters, descriptions)
- [ ] Show star rating on movie/series cards
- [ ] "My Favorites" page with all bookmarked content

## Sprint 4: Suggestions / Recommendations

- [ ] "Because you watched..." section (genre-based)
- [ ] "Trending" section (most popular on the provider)
- [ ] TMDB "similar movies" API for recommendations
- [ ] Algorithm: collaborative filtering based on watch history
- [ ] "Discover" page with curated recommendations

## Sprint 5: AI Features (Ollama)

- [ ] AI-generated CC/subtitles using Whisper transcription
- [ ] "What's happening?" button — Ollama vision describes current frame
- [ ] Scene descriptions for accessibility
- [ ] AI-powered content search ("find me action movies with car chases")
- [ ] Smart episode summaries ("previously on...")

## Technical Debt

- [ ] Replace M3U fallback entirely with Xtream API
- [ ] Add WebSocket for real-time "now playing" sync
- [ ] Improve transcode quality presets (720p, 1080p, 4K)
- [ ] Add subtitle support (.srt, .vtt)
- [ ] Multi-user profiles
