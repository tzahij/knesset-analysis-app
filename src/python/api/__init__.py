"""Flask application factory."""
import os
import sys
import logging

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv(os.path.join(project_root, ".env"))
load_dotenv(os.path.join(project_root, ".env.local"), override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


def create_app():
    app = Flask(__name__, static_folder=os.path.join(project_root, "public"))
    CORS(app)

    from src.python.api.routes.health import bp as health_bp
    from src.python.api.routes.members import bp as members_bp
    from src.python.api.routes.laws import bp as laws_bp
    from src.python.api.routes.protocols import bp as protocols_bp
    from src.python.api.routes.landing import bp as landing_bp
    from src.python.api.routes.stubs import bp as stubs_bp
    from src.python.api.routes.pages import bp as pages_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(members_bp)
    app.register_blueprint(laws_bp)
    app.register_blueprint(protocols_bp)
    app.register_blueprint(landing_bp)
    app.register_blueprint(stubs_bp)
    app.register_blueprint(pages_bp)

    # SPA static file serving
    from flask import send_from_directory

    @app.route("/")
    def serve_index():
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/<path:path>")
    def serve_static(path):
        # Never intercept API calls — let blueprints handle them
        if path.startswith("api/"):
            from flask import abort
            abort(404)
        full = os.path.join(app.static_folder, path)
        if os.path.exists(full) and os.path.isfile(full):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")

    return app
