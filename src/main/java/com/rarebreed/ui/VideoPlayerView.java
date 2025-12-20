package com.rarebreed.ui;

import com.rarebreed.service.M3UParser;
import com.rarebreed.service.VideoPlayer;
import com.vaadin.flow.component.button.Button;
import com.vaadin.flow.component.html.Div;
import com.vaadin.flow.component.orderedlayout.VerticalLayout;
import com.vaadin.flow.component.select.Select;
import com.vaadin.flow.component.upload.Upload;
import com.vaadin.flow.component.upload.receivers.MemoryBuffer;
import com.vaadin.flow.router.Route;
import jakarta.inject.Inject;

import java.io.IOException;
import java.util.List;

@Route("")
public class VideoPlayerView extends VerticalLayout {

    @Inject
    private M3UParser m3uParser;

    @Inject
    private VideoPlayer videoPlayer;

    private Select<String> urlSelect;

    public VideoPlayerView() {
        setupUI();
    }

    private void setupUI() {
        // M3U file upload
        MemoryBuffer buffer = new MemoryBuffer();
        Upload upload = new Upload(buffer);
        upload.setAcceptedFileTypes(".m3u", ".m3u8");

        // URL selector
        urlSelect = new Select<>();
        urlSelect.setLabel("Select Stream");
        urlSelect.setEnabled(false);

        // Control buttons
        Button playButton = new Button("Play", e -> play());
        Button pauseButton = new Button("Pause", e -> videoPlayer.pause());
        Button stopButton = new Button("Stop", e -> videoPlayer.stop());

        // Video container
        Div videoContainer = new Div();
        videoContainer.setId("video-container");
        videoContainer.setWidth("800px");
        videoContainer.setHeight("600px");

        upload.addSucceededListener(event -> {
            try {
                String fileName = "/tmp/" + event.getFileName();
                List<String> urls = m3uParser.parseM3U(fileName);
                urlSelect.setItems(urls);
                urlSelect.setEnabled(true);
            } catch (IOException ex) {
                ex.printStackTrace();
            }
        });

        add(upload, urlSelect, playButton, pauseButton, stopButton, videoContainer);
    }

    private void play() {
        String selectedUrl = urlSelect.getValue();
        if (selectedUrl != null) {
            videoPlayer.play(selectedUrl);
        }
    }
}
