#!/usr/bin/env python3

import requests
import json
import time

def debug_registration():
    base_url = "https://b5-search-proof.preview.emergentagent.com/api"
    
    # Try registration with detailed error logging
    phone = "9001234567"  # Valid 10-digit phone
    
    print(f"Testing registration with phone: {phone}")
    
    try:
        resp = requests.post(f"{base_url}/auth/register", 
                           json={
                               "phone": phone,
                               "pin": "1234",
                               "displayName": "<script>alert(1)</script>TestName"
                           },
                           headers={"Content-Type": "application/json"},
                           timeout=10)
        
        print(f"Status: {resp.status_code}")
        print(f"Headers: {dict(resp.headers)}")
        
        if resp.text:
            try:
                data = resp.json()
                print(f"Response JSON: {json.dumps(data, indent=2)}")
            except:
                print(f"Response text: {resp.text}")
        else:
            print("No response body")
            
    except Exception as e:
        print(f"Exception: {str(e)}")

if __name__ == "__main__":
    debug_registration()