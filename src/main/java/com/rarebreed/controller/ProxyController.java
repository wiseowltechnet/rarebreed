package com.rarebreed.controller;

import io.micronaut.http.annotation.Controller;
import io.micronaut.http.annotation.Get;
import io.micronaut.http.annotation.QueryValue;
import io.micronaut.http.HttpResponse;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse.BodyHandlers;
import java.net.URI;

@Controller("/proxy")
public class ProxyController {

    private final HttpClient httpClient = HttpClient.newHttpClient();

    @Get
    public HttpResponse<String> proxy(@QueryValue String url) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .build();

            java.net.http.HttpResponse<String> response = httpClient.send(request, BodyHandlers.ofString());

            return HttpResponse.ok(response.body())
                .header("Access-Control-Allow-Origin", "*")
                .contentType("text/plain");

        } catch (Exception e) {
            return HttpResponse.serverError("Error fetching M3U: " + e.getMessage());
        }
    }
}
