#!/usr/bin/env python3
"""
Quick Test to Validate Page Post Pinning Fix
"""

import requests
import json
import time

BASE_URL = "https://latency-crusher.preview.emergentagent.com/api"

# Use admin token from previous test  
admin_token = None
page_id = None

def get_admin_token():
    """Get admin authentication token"""
    global admin_token
    response = requests.post(f"{BASE_URL}/auth/login", json={
        "phone": "7777099001",
        "pin": "1234"
    })
    
    if response.status_code == 200:
        data = response.json()
        admin_token = data.get('token')
        return True
    return False

def create_test_page():
    """Create test page"""
    global page_id
    response = requests.post(f"{BASE_URL}/pages", 
        headers={'Authorization': f'Bearer {admin_token}', 'Content-Type': 'application/json'},
        json={
            "name": "PagePostPinTest",
            "category": "CLUB"
        }
    )
    
    if response.status_code == 201:
        data = response.json()
        page_id = data['page']['id']
        print(f"✅ Created test page: {page_id}")
        return True
    print(f"❌ Failed to create page: {response.json()}")
    return False

def test_page_post_pin_workflow():
    """Test the complete page post + pin workflow"""
    print("\n🔧 Testing Page Post Pin Workflow Fix...")
    
    # 1. Create post via /pages/:id/posts (should be authorType=PAGE)
    response = requests.post(f"{BASE_URL}/pages/{page_id}/posts",
        headers={'Authorization': f'Bearer {admin_token}', 'Content-Type': 'application/json'},
        json={
            "caption": "Test page post for pin validation"
        }
    )
    
    if response.status_code == 201:
        data = response.json()
        post_id = data['post']['id']
        author_type = data['post']['authorType']
        page_id_check = data['post']['pageId']
        
        print(f"✅ Created page post: {post_id}")
        print(f"   - authorType: {author_type}")
        print(f"   - pageId: {page_id_check}")
        
        if author_type != 'PAGE':
            print(f"❌ Expected authorType=PAGE, got {author_type}")
            return False
            
        # 2. Test pin operation
        pin_response = requests.post(f"{BASE_URL}/pages/{page_id}/posts/{post_id}/pin",
            headers={'Authorization': f'Bearer {admin_token}', 'Content-Type': 'application/json'}
        )
        
        if pin_response.status_code == 200:
            print(f"✅ Pin operation successful: {pin_response.json()}")
            
            # 3. Test unpin operation  
            unpin_response = requests.delete(f"{BASE_URL}/pages/{page_id}/posts/{post_id}/pin",
                headers={'Authorization': f'Bearer {admin_token}', 'Content-Type': 'application/json'}
            )
            
            if unpin_response.status_code == 200:
                print(f"✅ Unpin operation successful: {unpin_response.json()}")
                
                # 4. Test content endpoint with page-authored post
                content_response = requests.get(f"{BASE_URL}/content/{post_id}")
                
                if content_response.status_code == 200:
                    content_data = content_response.json()
                    post_data = content_data.get('post', {})
                    content_author_type = post_data.get('authorType')
                    author_info = post_data.get('author', {})
                    
                    print(f"✅ Content endpoint test:")
                    print(f"   - authorType: {content_author_type}")
                    print(f"   - author.name: {author_info.get('name')}")
                    
                    if content_author_type == 'PAGE':
                        print(f"✅ Content endpoint correctly shows authorType=PAGE")
                        return True
                    else:
                        print(f"❌ Content endpoint shows authorType={content_author_type}, expected PAGE")
                else:
                    print(f"❌ Content endpoint failed: {content_response.json()}")
            else:
                print(f"❌ Unpin failed: {unpin_response.json()}")
        else:
            print(f"❌ Pin failed: {pin_response.json()}")
    else:
        print(f"❌ Page post creation failed: {response.json()}")
    
    return False

def main():
    print("🚀 Testing Page Post Pin Workflow Fix")
    
    if not get_admin_token():
        print("❌ Failed to get admin token")
        return
        
    if not create_test_page():
        print("❌ Failed to create test page")
        return
        
    success = test_page_post_pin_workflow()
    
    if success:
        print("\n🎉 Page Post Pin Workflow: FULLY WORKING!")
    else:
        print("\n⚠️ Page Post Pin Workflow: Still has issues")

if __name__ == "__main__":
    main()