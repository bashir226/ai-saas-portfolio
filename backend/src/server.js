require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { OpenAI } = require('openai');

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || 'super-secret-ai-key-for-portfolio';
const DEFAULT_OPENAI_KEY = process.env.OPENAI_API_KEY;

// Middleware for authentication
const authenticate = async (req, res, next) => {
    // Check both Authorization header and query token for compatibility
    const authHeader = req.headers.authorization;
    let token = req.query.token;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    }

    if (!token) {
        return res.status(401).json({ detail: 'Missing authentication token' });
    }

    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        const user = await prisma.user.findUnique({ where: { username: decoded.sub } });
        if (!user) {
            return res.status(401).json({ detail: 'Invalid token: user not found' });
        }
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ detail: 'Invalid token' });
    }
};

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const existingUser = await prisma.user.findUnique({ where: { username } });
        if (existingUser) {
            return res.status(400).json({ detail: 'Username already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.create({
            data: { username, password: hashedPassword }
        });

        res.json({ message: 'User registered successfully!' });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) {
            return res.status(401).json({ detail: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ detail: 'Invalid credentials' });
        }

        const token = jwt.sign({ sub: user.username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ access_token: token, token_type: 'bearer' });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

app.get('/api/me', authenticate, (req, res) => {
    res.json({ username: req.user.username, credits: req.user.credits });
});

// --- SETTINGS ---
app.post('/api/settings', authenticate, async (req, res) => {
    try {
        const { openai_key, password } = req.body;
        const updateData = {};
        
        if (openai_key !== undefined) {
            updateData.openai_key = openai_key.trim() || null;
        }
        
        if (password && password.trim()) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        await prisma.user.update({
            where: { id: req.user.id },
            data: updateData
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

// --- GENERATION ROUTES ---
app.post('/api/generate', authenticate, async (req, res) => {
    try {
        const { prompt, tone = 'Professional', platform = 'General', model = 'gpt-3.5-turbo' } = req.body;
        const COST_PER_GENERATION = 10;
        
        let user = req.user;
        const userApiKey = user.openai_key || DEFAULT_OPENAI_KEY;
        const isByok = !!user.openai_key;

        if (!isByok && user.credits < COST_PER_GENERATION) {
            return res.status(402).json({ detail: 'Not enough credits. Please upgrade your plan or add your API key in Settings.' });
        }

        if (!isByok) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: { credits: user.credits - COST_PER_GENERATION }
            });
        }

        const remaining = user.credits;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        res.write(`data: ${JSON.stringify({ type: 'meta', remaining_credits: remaining })}\n\n`);

        let fullText = "";

        if (userApiKey) {
            try {
                const openai = new OpenAI({ apiKey: userApiKey });
                const instruction = `You are a professional social media copywriter. Write a post for ${platform}. Tone of voice: ${tone}.`;
                
                const stream = await openai.chat.completions.create({
                    model: model,
                    messages: [
                        { role: 'system', content: instruction },
                        { role: 'user', content: prompt }
                    ],
                    max_tokens: 300,
                    stream: true,
                });

                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content || "";
                    if (content) {
                        fullText += content;
                        res.write(`data: ${JSON.stringify({ type: 'content', text: content })}\n\n`);
                    }
                }
            } catch (err) {
                console.error("OpenAI Error:", err.message);
                const fallbackMsg = `\n\n> [!WARNING]\n> **API Error:** ${err.message}\n> \n> Falling back to mock generation...`;
                fullText += fallbackMsg;
                res.write(`data: ${JSON.stringify({ type: 'content', text: fallbackMsg })}\n\n`);
            }
        } else {
            // Mock Streaming Fallback
            const mockText = `✨ [AI MOCK GENERATED] ✨\n\nВот ваш идеальный пост (${tone}) для ${platform} на тему: '${prompt}'.\n\nВ современном мире технологии развиваются с невероятной скоростью. ${prompt} - это то, что меняет правила игры каждый день! Не упустите свой шанс быть в тренде. 🚀\n\n(Note: Add your OpenAI Key in Settings!)`;
            
            const chunks = mockText.match(/.{1,5}/g) || [];
            for (const chunk of chunks) {
                fullText += chunk;
                res.write(`data: ${JSON.stringify({ type: 'content', text: chunk })}\n\n`);
                await new Promise(r => setTimeout(r, 50)); // Artificial delay
            }
        }

        // Save to DB after streaming completes
        await prisma.post.create({
            data: {
                userId: user.id,
                prompt: prompt,
                content: fullText
            }
        });

        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
        res.end();
    } catch (error) {
        console.error(error);
        res.write(`data: ${JSON.stringify({ type: 'error', detail: error.message })}\n\n`);
        res.end();
    }
});

app.post('/api/generate/image', authenticate, async (req, res) => {
    try {
        const { prompt } = req.body;
        const COST_PER_GENERATION = 20;
        
        let user = req.user;
        if (user.credits < COST_PER_GENERATION) {
            return res.status(402).json({ detail: 'Not enough credits.' });
        }

        user = await prisma.user.update({
            where: { id: user.id },
            data: { credits: user.credits - COST_PER_GENERATION }
        });

        // Mock AI Image
        const generatedImgUrl = "/mock_ai_generated_art.png";

        await prisma.post.create({
            data: {
                userId: user.id,
                prompt: prompt,
                content: `[IMAGE] ${generatedImgUrl}`
            }
        });

        res.json({
            success: true,
            result: generatedImgUrl,
            remaining_credits: user.credits
        });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

// --- HISTORY ROUTES ---
app.get('/api/history', authenticate, async (req, res) => {
    try {
        const posts = await prisma.post.findMany({
            where: { userId: req.user.id },
            orderBy: { id: 'desc' }
        });

        res.json({
            success: true,
            history: posts.map(p => ({
                id: p.id,
                prompt: p.prompt,
                content: p.content,
                created_at: p.createdAt.toISOString(),
                is_favorite: p.isFavorite
            }))
        });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

app.delete('/api/history/:id', authenticate, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const post = await prisma.post.findFirst({
            where: { id: postId, userId: req.user.id }
        });

        if (post) {
            await prisma.post.delete({ where: { id: postId } });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

app.post('/api/history/:id/favorite', authenticate, async (req, res) => {
    try {
        const postId = parseInt(req.params.id);
        const post = await prisma.post.findFirst({
            where: { id: postId, userId: req.user.id }
        });

        if (post) {
            await prisma.post.update({
                where: { id: postId },
                data: { isFavorite: !post.isFavorite }
            });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ detail: error.message });
    }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
});
