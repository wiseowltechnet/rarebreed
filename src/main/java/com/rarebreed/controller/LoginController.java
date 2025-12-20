package com.rarebreed.controller;

import io.micronaut.http.annotation.*;
import io.micronaut.http.HttpResponse;
import jakarta.inject.Singleton;
import java.util.Map;
import java.net.URI;

@Controller("/auth")
@Singleton
public class LoginController {

    @Get("/login")
    public HttpResponse<String> loginPage() {
        return HttpResponse.ok("""
            <!DOCTYPE html>
            <html>
            <head>
                <title>RareBreed Player - Login</title>
                <meta charset="UTF-8">
                <style>
                    body { font-family: 'Segoe UI', sans-serif; margin: 0; padding: 0; background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%); color: white; height: 100vh; display: flex; align-items: center; justify-content: center; }
                    .login-container { background: rgba(255,255,255,0.15); border-radius: 20px; padding: 40px; backdrop-filter: blur(15px); box-shadow: 0 8px 32px rgba(0,0,0,0.3); width: 400px; text-align: center; }
                    .logo { font-size: 3em; margin-bottom: 20px; }
                    h1 { margin: 0 0 30px 0; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
                    .form-group { margin-bottom: 20px; text-align: left; }
                    label { display: block; margin-bottom: 8px; font-weight: bold; }
                    input { width: 100%; padding: 15px; border: none; border-radius: 10px; font-size: 16px; background: rgba(255,255,255,0.9); box-sizing: border-box; }
                    button { width: 100%; padding: 15px; background: linear-gradient(45deg, #ff6b6b, #ee5a52); color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; }
                    button:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.3); }
                    .error { color: #ff6b6b; margin-top: 15px; }
                    .hint { font-size: 0.9em; opacity: 0.7; margin-top: 15px; }
                </style>
            </head>
            <body>
                <div class="login-container">
                    <div class="logo">🏆</div>
                    <h1>RareBreed Player</h1>
                    <form id="loginForm">
                        <div class="form-group">
                            <label>Username:</label>
                            <input type="text" id="username" required>
                        </div>
                        <div class="form-group">
                            <label>Password:</label>
                            <input type="password" id="password" required>
                        </div>
                        <button type="submit">🚀 Login</button>
                        <div id="error" class="error"></div>
                        <div class="hint">Default: admin / rarebreed</div>
                    </form>
                </div>

                <script>
                document.getElementById('loginForm').addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const username = document.getElementById('username').value;
                    const password = document.getElementById('password').value;

                    try {
                        const response = await fetch('/auth/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username, password })
                        });

                        if (response.ok) {
                            window.location.href = '/';
                        } else {
                            document.getElementById('error').textContent = 'Invalid credentials';
                        }
                    } catch (error) {
                        document.getElementById('error').textContent = 'Login failed';
                    }
                });
                </script>
            </body>
            </html>
            """).contentType("text/html; charset=UTF-8");
    }

    @Post("/login")
    public HttpResponse<?> login(@Body Map<String, String> credentials) {
        String username = credentials.get("username");
        String password = credentials.get("password");

        // Simple auth check
        if ("admin".equals(username) && "rarebreed".equals(password)) {
            return HttpResponse.ok().header("Set-Cookie", "auth=true; Path=/; HttpOnly");
        }

        return HttpResponse.unauthorized();
    }

    @Get("/logout")
    public HttpResponse<?> logout() {
        return HttpResponse.redirect(URI.create("/auth/login"))
            .header("Set-Cookie", "auth=; Path=/; HttpOnly; Max-Age=0");
    }
}
