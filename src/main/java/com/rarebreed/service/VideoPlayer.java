package com.rarebreed.service;

import jakarta.inject.Singleton;
import uk.co.caprica.vlcj.factory.MediaPlayerFactory;
import uk.co.caprica.vlcj.player.embedded.EmbeddedMediaPlayer;

@Singleton
public class VideoPlayer {

    private final MediaPlayerFactory factory;
    private EmbeddedMediaPlayer player;

    public VideoPlayer() {
        this.factory = new MediaPlayerFactory();
        this.player = factory.mediaPlayers().newEmbeddedMediaPlayer();
    }

    public void play(String url) {
        player.media().play(url);
    }

    public void stop() {
        player.controls().stop();
    }

    public void pause() {
        player.controls().pause();
    }

    public EmbeddedMediaPlayer getPlayer() {
        return player;
    }
}
