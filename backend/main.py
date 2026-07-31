from flask import Flask, request, jsonify
from flask_cors import CORS
from sqlalchemy import create_engine, Column, Integer, String
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
import jwt
import datetime
import os
import requests
from dotenv import load_dotenv

load_dotenv()

# --- CONFIG ---
SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "super-secret-ai-key-for-portfolio")
ALGORITHM = "HS256"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# --- DATABASE SETUP ---
SQLALCHEMY_DATABASE_URL = "sqlite:///./sql_app.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String) # For a real app, hash this!
    credits = Column(Integer, default=100) # Give 100 free credits on sign up

class Post(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    prompt = Column(String)
    content = Column(String)
    created_at = Column(String)

Base.metadata.create_all(bind=engine)

# --- APP SETUP ---
app = Flask(__name__)
CORS(app)

import logging
logging.basicConfig(filename='flask.log', level=logging.DEBUG)
@app.errorhandler(Exception)
def handle_exception(e):
    logging.exception("Unhandled Exception")
    return "Internal Server Error", 500

# --- DEPENDENCIES ---
def get_current_user(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
    except jwt.PyJWTError:
        return None
    
    db = SessionLocal()
    user = db.query(User).filter(User.username == username).first()
    db.close()
    return user

# --- AUTH ROUTES ---
@app.route("/api/register", methods=["POST"])
def register():
    try:
        data = request.json
        username = data.get("username")
        password = data.get("password")
        
        db = SessionLocal()
        db_user = db.query(User).filter(User.username == username).first()
        if db_user:
            db.close()
            return jsonify({"detail": "Username already registered"}), 400
        
        new_user = User(username=username, password=password)
        db.add(new_user)
        db.commit()
        db.close()
        return jsonify({"message": "User registered successfully!"})
    except Exception as e:
        return jsonify({"detail": str(e)}), 500

@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username")
    password = data.get("password")
    
    db = SessionLocal()
    user = db.query(User).filter(User.username == username, User.password == password).first()
    db.close()
    
    if not user:
        return jsonify({"detail": "Invalid credentials"}), 401
    
    # Create JWT Token
    expiration = datetime.datetime.utcnow() + datetime.timedelta(hours=24)
    token = jwt.encode({"sub": user.username, "exp": expiration}, SECRET_KEY, algorithm=ALGORITHM)
    
    return jsonify({"access_token": token, "token_type": "bearer"})

@app.route("/api/me", methods=["GET"])
def get_me():
    token = request.args.get("token")
    user = get_current_user(token)
    if not user:
        return jsonify({"detail": "Invalid token"}), 401
    return jsonify({"username": user.username, "credits": user.credits})

# --- AI ROUTES ---
@app.route("/api/generate", methods=["POST"])
def generate_content():
    token = request.args.get("token")
    user = get_current_user(token)
    if not user:
        return jsonify({"detail": "Invalid token"}), 401
    
    data = request.json
    prompt = data.get("prompt", "")
    
    COST_PER_GENERATION = 10
    if user.credits < COST_PER_GENERATION:
        return jsonify({"detail": "Not enough credits. Please upgrade your plan."}), 402
    
    db = SessionLocal()
    db_user = db.query(User).filter(User.username == user.username).first()
    db_user.credits -= COST_PER_GENERATION
    db.commit()
    remaining = db_user.credits
    db.close()
    
    # AI Generation Logic (Real OpenAI API with Fallback)
    generated_text = ""
    if OPENAI_API_KEY:
        try:
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-3.5-turbo",
                    "messages": [
                        {"role": "system", "content": "You are a professional social media copywriter. Write highly engaging, conversion-focused posts."},
                        {"role": "user", "content": prompt}
                    ],
                    "max_tokens": 300
                },
                timeout=15
            )
            if response.status_code == 200:
                generated_text = response.json()["choices"][0]["message"]["content"]
            else:
                logging.error(f"OpenAI API Error: {response.text}")
        except Exception as e:
            logging.error(f"OpenAI Request Exception: {e}")
            
    # Fallback if API key is missing or request failed
    if not generated_text:
        generated_text = f"✨ [AI MOCK GENERATED] ✨\n\nВот ваш идеальный пост на тему: '{prompt}'.\n\nВ современном мире технологии развиваются с невероятной скоростью. {prompt} - это то, что меняет правила игры каждый день! Не упустите свой шанс быть в тренде. 🚀\n\n#технологии #будущее\n\n(Note: Add OPENAI_API_KEY to .env to use real AI!)"
    
    # Save to history
    db = SessionLocal()
    new_post = Post(
        user_id=db_user.id,
        prompt=prompt,
        content=generated_text,
        created_at=datetime.datetime.utcnow().isoformat()
    )
    db.add(new_post)
    db.commit()
    db.close()

    return jsonify({
        "success": True,
        "result": generated_text,
        "remaining_credits": remaining
    })

@app.route("/api/generate/image", methods=["POST"])
def generate_image():
    token = request.args.get("token")
    user = get_current_user(token)
    if not user:
        return jsonify({"detail": "Invalid token"}), 401
    
    data = request.json
    prompt = data.get("prompt", "")
    
    COST_PER_GENERATION = 20 # Images cost more
    if user.credits < COST_PER_GENERATION:
        return jsonify({"detail": "Not enough credits."}), 402
    
    db = SessionLocal()
    db_user = db.query(User).filter(User.username == user.username).first()
    db_user.credits -= COST_PER_GENERATION
    db.commit()
    remaining = db_user.credits
    
    # Mock AI Image Generation (returns path to our mock image)
    generated_img_url = "/mock_ai_generated_art.png"
    
    # Save to history with a special tag
    new_post = Post(
        user_id=db_user.id,
        prompt=prompt,
        content=f"[IMAGE] {generated_img_url}",
        created_at=datetime.datetime.utcnow().isoformat()
    )
    db.add(new_post)
    db.commit()
    db.close()

    return jsonify({
        "success": True,
        "result": generated_img_url,
        "remaining_credits": remaining
    })

@app.route("/api/history", methods=["GET"])
def get_history():
    token = request.args.get("token")
    user = get_current_user(token)
    if not user:
        return jsonify({"detail": "Invalid token"}), 401
    
    db = SessionLocal()
    posts = db.query(Post).filter(Post.user_id == user.id).order_by(Post.id.desc()).all()
    db.close()
    
    return jsonify([
        {"id": p.id, "prompt": p.prompt, "content": p.content, "created_at": p.created_at}
        for p in posts
    ])

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
