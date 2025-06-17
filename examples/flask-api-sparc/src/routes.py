from flask import Blueprint, request, jsonify
from models import db, User, Product
from services import UserService, ProductService

api_bp = Blueprint('api', __name__)
user_service = UserService()
product_service = ProductService()

# User routes
@api_bp.route('/users', methods=['GET'])
def get_users():
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 10, type=int)
    
    users = User.query.paginate(page=page, per_page=per_page)
    return jsonify({
        'users': [u.to_dict() for u in users.items],
        'total': users.total,
        'pages': users.pages,
        'current_page': page
    })

@api_bp.route('/users/<int:user_id>', methods=['GET'])
def get_user(user_id):
    user = User.query.get_or_404(user_id)
    return jsonify(user.to_dict())

@api_bp.route('/users', methods=['POST'])
def create_user():
    data = request.get_json()
    
    # Validation
    if not data.get('username') or not data.get('email'):
        return jsonify({'error': 'Username and email required'}), 400
    
    # Check if user exists
    if User.query.filter_by(username=data['username']).first():
        return jsonify({'error': 'Username already exists'}), 409
    
    user = user_service.create_user(data)
    return jsonify(user.to_dict()), 201

@api_bp.route('/users/<int:user_id>', methods=['PUT'])
def update_user(user_id):
    user = User.query.get_or_404(user_id)
    data = request.get_json()
    
    user = user_service.update_user(user, data)
    return jsonify(user.to_dict())

@api_bp.route('/users/<int:user_id>', methods=['DELETE'])
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    user_service.delete_user(user)
    return '', 204

# Product routes
@api_bp.route('/products', methods=['GET'])
def get_products():
    products = Product.query.all()
    return jsonify([p.to_dict() for p in products])

@api_bp.route('/products', methods=['POST'])
def create_product():
    data = request.get_json()
    product = product_service.create_product(data)
    return jsonify(product.to_dict()), 201
