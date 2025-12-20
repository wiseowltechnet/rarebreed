package com.rarebreed.service;

import com.rarebreed.config.IptvConfig;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Singleton
public class M3UParser {

    @Inject
    private IptvConfig iptvConfig;

    public List<String> parseM3U(String filePath) throws IOException {
        List<String> urls = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(filePath))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.startsWith("#") && !line.trim().isEmpty()) {
                    String url = line.trim();
                    if (url.contains("username=") || url.contains("password=")) {
                        urls.add(url);
                    } else {
                        urls.add(url + "?username=" + iptvConfig.getUsername() + "&password=" + iptvConfig.getPassword());
                    }
                }
            }
        }
        return urls;
    }
}
