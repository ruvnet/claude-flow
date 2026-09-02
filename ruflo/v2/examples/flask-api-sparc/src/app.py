from flask import Flask
from flask_cors import CORS
from config import Config
from models import db
from routes import api_bp

def create_app(config_name='development'):
    app = Flask(__name__)
    app.config.from_object(Config[config_name])
    
    # Initialize extensions
    db.init_app(app)
    CORS(app)
    
    # Register blueprints
    app.register_blueprint(api_bp, url_prefix='/api')
    
    # Health check
    @app.route('/health')
    def health_check():
        return {'status': 'healthy', 'service': 'REST API'}
    
    return app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=True)
