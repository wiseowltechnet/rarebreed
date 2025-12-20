package com.rarebreed.controller;

import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.HttpResponse;

@Controller
public class VideoController {

    @Get("/")
    public HttpResponse<String> index() {
        return HttpResponse.ok("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>RareBreed Player</title>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; }
                    .container { max-width: 1200px; margin: 0 auto; }
                    .header { text-align: center; margin-bottom: 30px; }
                    .header h1 { font-size: 3em; margin: 0; text-shadow: 3px 3px 6px rgba(0,0,0,0.7); background: linear-gradient(45deg, #ff6b6b, #4ecdc4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                    .header p { font-size: 1.2em; opacity: 0.9; margin: 10px 0; }
                    .player-section { background: rgba(255,255,255,0.15); border-radius: 20px; padding: 30px; margin-bottom: 25px; backdrop-filter: blur(15px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
                    .controls { display: flex; gap: 15px; margin-bottom: 25px; flex-wrap: wrap; }
                    .controls input, .controls select, .controls button { padding: 15px; border: none; border-radius: 10px; font-size: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
                    .controls input { flex: 1; min-width: 350px; background: rgba(255,255,255,0.9); }
                    .controls button { background: linear-gradient(45deg, #ff6b6b, #ee5a52); color: white; cursor: pointer; transition: all 0.3s; font-weight: bold; }
                    .controls button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
                    .video-area { background: linear-gradient(135deg, #000 0%, #1a1a1a 100%); border-radius: 15px; height: 450px; display: flex; align-items: center; justify-content: center; margin-bottom: 25px; border: 3px solid rgba(255,255,255,0.1); }
                    .playback-controls { display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; }
                    .playback-controls button { padding: 18px 30px; background: linear-gradient(45deg, #4ecdc4, #44a08d); color: white; border: none; border-radius: 12px; cursor: pointer; font-size: 16px; font-weight: bold; transition: all 0.3s; }
                    .playback-controls button:hover { transform: translateY(-3px); box-shadow: 0 8px 25px rgba(0,0,0,0.4); }
                    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin: 25px 0; }
                    .feature { background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05)); padding: 20px; border-radius: 15px; text-align: center; border: 1px solid rgba(255,255,255,0.1); }
                    .feature h3 { margin: 0 0 10px 0; font-size: 1.1em; }
                    .disclaimer { background: linear-gradient(135deg, rgba(255,107,107,0.2), rgba(238,90,82,0.1)); border-radius: 15px; padding: 25px; margin-top: 25px; border: 1px solid rgba(255,107,107,0.3); }
                    .logo { font-size: 2em; margin-bottom: 10px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <div class="logo">🏆</div>
                        <h1>RareBreed Player</h1>
                        <p>Premium Media Streaming Experience</p>
                        <p style="font-size: 0.9em; opacity: 0.7;">Built for Excellence • Designed for Performance</p>
                    </div>

                    <div class="features">
                        <div class="feature">
                            <h3>🚀 Lightning Fast</h3>
                            <p>Optimized streaming engine</p>
                        </div>
                        <div class="feature">
                            <h3>🎯 Multi-Format</h3>
                            <p>M3U, JSON & more</p>
                        </div>
                        <div class="feature">
                            <h3>💎 Premium Quality</h3>
                            <p>4K ready playback</p>
                        </div>
                        <div class="feature">
                            <h3>🔒 Secure & Private</h3>
                            <p>Your media, your control</p>
                        </div>
                    </div>

                    <div class="player-section">
                        <div class="controls">
                            <input type="text" id="urlInput" placeholder="🔗 Enter your playlist URL (M3U/JSON)" value="http://greencube.pro:8080/get.php?username=CourtneY&password=9195221170&type=m3u">
                            <button onclick="loadPlaylist()">📡 Load Playlist</button>
                            <select id="channelSelect" disabled style="min-width: 250px; background: rgba(255,255,255,0.9);">
                                <option>📋 Load playlist first...</option>
                            </select>
                        </div>

                        <div class="video-area" id="videoArea">
                            <div style="text-align: center;">
                                <div style="font-size: 4em; margin-bottom: 20px;">🎬</div>
                                <h2>RareBreed Player Ready</h2>
                                <p style="opacity: 0.8;">Click "Load Playlist" to fetch your IPTV channels</p>
                                <p style="font-size: 0.9em; opacity: 0.6;">GreenCube M3U URL pre-loaded with credentials</p>
                            </div>
                        </div>

                        <div class="playback-controls">
                            <button onclick="play()">▶️ Play</button>
                            <button onclick="pause()">⏸️ Pause</button>
                            <button onclick="stop()">⏹️ Stop</button>
                            <button onclick="fullscreen()">🔳 Fullscreen</button>
                            <button onclick="settings()">⚙️ Settings</button>
                        </div>
                    </div>

                    <div class="disclaimer">
                        <h3>⚖️ Legal Notice</h3>
                        <p><strong>RareBreed Player</strong> is a personal media player application. This software does not provide, host, distribute, or promote any copyrighted content. Users are responsible for ensuring they have proper rights to access and stream their media content.</p>
                        <p>By using RareBreed Player, you agree to comply with all applicable copyright laws and regulations in your jurisdiction.</p>
                    </div>
                </div>

                <script>
                let currentUrl = '';
                let isPlaying = false;
                let currentChannel = '';

                async function loadPlaylist() {
                    const url = document.getElementById('urlInput').value;
                    if (!url) {
                        alert('Please enter a playlist URL');
                        return;
                    }

                    try {
                        document.getElementById('videoArea').innerHTML = '<div style="text-align: center;"><div style="font-size: 3em;">⏳</div><h3>Loading Playlist...</h3><p>Fetching your IPTV channels</p></div>';

                        const response = await fetch('/proxy?url=' + encodeURIComponent(url));
                        const content = await response.text();

                        if (url.toLowerCase().includes('.json')) {
                            parseJSON(content);
                        } else {
                            parseM3U(content);
                        }
                    } catch (error) {
                        document.getElementById('videoArea').innerHTML = '<div style="text-align: center; color: #ff6b6b;"><div style="font-size: 3em;">❌</div><h3>Loading Failed</h3><p>' + error.message + '</p></div>';
                    }
                }

                function parseM3U(content) {
                    const lines = content.split('\\n');
                    const select = document.getElementById('channelSelect');
                    select.innerHTML = '<option>📺 Select channel...</option>';

                    let channelName = '';
                    let count = 0;

                    lines.forEach(line => {
                        if (line.startsWith('#EXTINF:')) {
                            channelName = line.split(',')[1]?.trim() || 'Channel ' + (++count);
                        } else if (line.trim() && !line.startsWith('#')) {
                            const option = document.createElement('option');
                            option.value = line.trim();
                            option.textContent = '📡 ' + (channelName || 'Channel ' + (++count));
                            select.appendChild(option);
                        }
                    });

                    select.disabled = false;
                    document.getElementById('videoArea').innerHTML = '<div style="text-align: center;"><div style="font-size: 3em;">✅</div><h3>IPTV Channels Loaded</h3><p><strong>' + (select.options.length - 1) + '</strong> channels ready to stream</p></div>';
                }

                function parseJSON(content) {
                    try {
                        const data = JSON.parse(content);
                        const select = document.getElementById('channelSelect');
                        select.innerHTML = '<option>📺 Select channel...</option>';

                        const channels = data.channels || data.playlist || data;

                        channels.forEach((channel, index) => {
                            const option = document.createElement('option');
                            option.value = channel.url || channel.stream_url || channel.link;
                            option.textContent = '📡 ' + (channel.name || channel.title || 'Channel ' + (index + 1));
                            select.appendChild(option);
                        });

                        select.disabled = false;
                        document.getElementById('videoArea').innerHTML = '<div style="text-align: center;"><div style="font-size: 3em;">✅</div><h3>JSON Playlist Loaded</h3><p><strong>' + channels.length + '</strong> channels available</p></div>';
                    } catch (e) {
                        throw new Error('Invalid JSON playlist format');
                    }
                }

                function play() {
                    const select = document.getElementById('channelSelect');
                    if (select.value && !select.value.startsWith('📺') && !select.value.startsWith('📋')) {
                        currentUrl = select.value;
                        currentChannel = select.options[select.selectedIndex].text;
                        isPlaying = true;

                        document.getElementById('videoArea').innerHTML =
                            '<div style="text-align: center; padding: 40px;"><div style="font-size: 3em; margin-bottom: 20px;">📺</div><h2>🔴 LIVE</h2><h3>' +
                            currentChannel + '</h3><p style="font-size: 0.9em; opacity: 0.7; word-break: break-all;">Stream: ' +
                            currentUrl + '</p><div style="margin-top: 20px; padding: 10px; background: rgba(76,175,80,0.2); border-radius: 10px;">RareBreed Player Active</div></div>';
                    } else {
                        alert('Please select a channel first');
                    }
                }

                function pause() {
                    if (isPlaying) {
                        isPlaying = false;
                        document.getElementById('videoArea').innerHTML = '<div style="text-align: center; padding: 50px;"><div style="font-size: 3em;">⏸️</div><h3>Playback Paused</h3><p>' + currentChannel + '</p></div>';
                    }
                }

                function stop() {
                    isPlaying = false;
                    currentUrl = '';
                    currentChannel = '';
                    document.getElementById('videoArea').innerHTML = '<div style="text-align: center; padding: 50px;"><div style="font-size: 3em;">⏹️</div><h3>Playback Stopped</h3><p>RareBreed Player Ready</p></div>';
                }

                function fullscreen() {
                    const videoArea = document.getElementById('videoArea');
                    if (videoArea.requestFullscreen) {
                        videoArea.requestFullscreen();
                    }
                }

                function settings() {
                    alert('⚙️ RareBreed Player Settings\\n\\n🎵 Audio: Stereo\\n🎥 Video: Auto Quality\\n🌐 Network: Adaptive\\n💾 Cache: Enabled\\n\\nMore settings coming soon!');
                }
                </script>
            </body>
            </html>
            """).contentType("text/html; charset=UTF-8");
    }
}
