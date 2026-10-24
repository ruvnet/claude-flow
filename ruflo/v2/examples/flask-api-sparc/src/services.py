from models import db, User, Product

class UserService:
    def create_user(self, data):
        user = User(
            username=data['username'],
            email=data['email']
        )
        if 'password' in data:
            user.set_password(data['password'])
        
        db.session.add(user)
        db.session.commit()
        return user
    
    def update_user(self, user, data):
        if 'username' in data:
            user.username = data['username']
        if 'email' in data:
            user.email = data['email']
        if 'password' in data:
            user.set_password(data['password'])
        
        db.session.commit()
        return user
    
    def delete_user(self, user):
        db.session.delete(user)
        db.session.commit()
    
    def get_user(self, user_id):
        return User.query.get(user_id)

class ProductService:
    def create_product(self, data):
        product = Product(
            name=data['name'],
            description=data.get('description', ''),
            price=data['price'],
            stock=data.get('stock', 0)
        )
        
        db.session.add(product)
        db.session.commit()
        return product
    
    def update_product(self, product, data):
        if 'name' in data:
            product.name = data['name']
        if 'description' in data:
            product.description = data['description']
        if 'price' in data:
            product.price = data['price']
        if 'stock' in data:
            product.stock = data['stock']
        
        db.session.commit()
        return product
