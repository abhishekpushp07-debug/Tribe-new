#!/usr/bin/env python3
"""
Tribe Moderation System - Comprehensive Testing
Focus: Provider-Adapter Pattern Refactor Validation
"""

import asyncio
import aiohttp
import json
import time

BASE_URL = "https://college-verify-tribe.preview.emergentagent.com/api"
EXISTING_USER = {"phone": "9000000001", "pin": "1234"}

class TribeModerationValidator:
    def __init__(self):
        self.session = None
        self.test_results = []
        self.user_token = None

    async def setup_session(self):
        connector = aiohttp.TCPConnector(limit=100)
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(
            connector=connector, 
            timeout=timeout,
            headers={'Content-Type': 'application/json'}
        )

    async def cleanup_session(self):
        if self.session:
            await self.session.close()

    async def log_result(self, test_name: str, success: bool, details: str = ""):
        status = "✅ PASS" if success else "❌ FAIL"
        result = {"test": test_name, "success": success, "details": details, "timestamp": time.time()}
        self.test_results.append(result)
        print(f"{status} {test_name}: {details}")

    async def make_request(self, method: str, endpoint: str, data=None, token=None):
        url = f"{BASE_URL}{endpoint}"
        headers = {}
        
        if token:
            headers['Authorization'] = f'Bearer {token}'
            
        try:
            async with self.session.request(method.upper(), url, json=data, headers=headers) as response:
                result = await response.json()
                return response.status, result
        except Exception as e:
            return 500, {"error": f"Request failed: {str(e)}"}

    async def authenticate(self):
        status, data = await self.make_request('POST', '/auth/login', EXISTING_USER)
        if status == 200 and data.get('token'):
            self.user_token = data['token']
            await self.log_result("Authentication", True, "User authenticated successfully")
            return True
        else:
            await self.log_result("Authentication", False, f"Login failed: {status}")
            return False

    async def test_health_endpoints(self):
        """Test core API health including deep moderation provider checks"""
        
        # Basic API health
        status, data = await self.make_request('GET', '/')
        if status == 200 and data.get('name') == 'Tribe API':
            await self.log_result("API Health", True, f"Tribe API v{data.get('version')} operational")
        else:
            await self.log_result("API Health", False, f"API health check failed: {status}")

        # Deep health check with moderation provider validation
        status, data = await self.make_request('GET', '/ops/health')
        if status == 200:
            checks = data.get('checks', {})
            mod_check = checks.get('moderation', {})
            
            if mod_check.get('status') == 'ok':
                provider = mod_check.get('provider')
                chain = mod_check.get('providerChain', [])
                await self.log_result("Deep Health (Moderation)", True, 
                    f"Moderation system healthy - Provider: {provider}, Chain: {chain}")
            else:
                await self.log_result("Deep Health (Moderation)", False, 
                    f"Moderation system unhealthy: {mod_check}")
        else:
            await self.log_result("Deep Health (Moderation)", False, f"Health check failed: {status}")

    async def test_moderation_config_endpoint(self):
        """Test the new moderation configuration endpoint"""
        
        status, data = await self.make_request('GET', '/moderation/config')
        
        if status == 200:
            required_fields = ['provider', 'activeProvider', 'providerChain', 'failOpen', 'thresholds']
            missing = [f for f in required_fields if f not in data]
            
            if not missing:
                provider = data.get('provider')
                active = data.get('activeProvider') 
                chain = data.get('providerChain', [])
                
                # Validate expected configuration from .env
                if provider == 'composite' and active == 'composite' and 'openai' in chain and 'fallback' in chain:
                    await self.log_result("Moderation Config API", True, 
                        f"Provider: {provider}, Active: {active}, Chain: {chain}")
                else:
                    await self.log_result("Moderation Config API", False, 
                        f"Unexpected config - Provider: {provider}, Chain: {chain}")
            else:
                await self.log_result("Moderation Config API", False, f"Missing fields: {missing}")
        else:
            await self.log_result("Moderation Config API", False, f"API call failed: {status}")

    async def test_moderation_check_endpoint(self):
        """Test the new moderation check endpoint with comprehensive test cases"""
        
        test_cases = [
            {
                "name": "Clean Content",
                "text": "Beautiful sunny day at college! Having fun with friends and studying hard.",
                "expected": "ALLOW"
            },
            {
                "name": "Academic Frustration", 
                "text": "This calculus assignment is really challenging and frustrating me",
                "expected": ["ALLOW", "ESCALATE"]
            },
            {
                "name": "Direct Violence Threat",
                "text": "I will kill you and your entire family tonight, you deserve to die",
                "expected": ["ESCALATE", "REJECT"]
            },
            {
                "name": "Sexual Exploitation",
                "text": "young children in sexual situations and explicit content sharing", 
                "expected": ["ESCALATE", "REJECT"]
            },
            {
                "name": "Self-Harm Content",
                "text": "I want to kill myself and end my life, here's how to do it",
                "expected": ["ESCALATE", "REJECT"]
            },
            {
                "name": "Hate Speech",
                "text": "All people from that region are worthless scum who should be eliminated",
                "expected": ["ESCALATE", "REJECT"]
            }
        ]
        
        for case in test_cases:
            status, data = await self.make_request('POST', '/moderation/check', {"text": case["text"]})
            
            if status == 200:
                action = data.get('action')
                provider = data.get('provider')
                confidence = data.get('confidence', 0)
                
                expected = case["expected"]
                if isinstance(expected, list):
                    success = action in expected
                else:
                    success = action == expected
                
                details = f"Action: {action}, Provider: {provider}, Confidence: {confidence:.3f}"
                await self.log_result(f"Moderation Check - {case['name']}", success, details)
                
                # Validate review ticket creation for escalated/rejected content
                if action in ['ESCALATE', 'REJECT']:
                    ticket_id = data.get('reviewTicketId')
                    if ticket_id:
                        await self.log_result(f"Review Ticket - {case['name']}", True, f"Ticket: {ticket_id}")
                    else:
                        await self.log_result(f"Review Ticket - {case['name']}", False, "No ticket created")
                        
            else:
                await self.log_result(f"Moderation Check - {case['name']}", False, f"API failed: {status}")

    async def test_content_creation_with_moderation(self):
        """Test content creation integration with the new moderation system"""
        
        if not self.user_token:
            await self.log_result("Content Integration", False, "No authenticated user")
            return
        
        content_scenarios = [
            {
                "name": "Clean Post",
                "caption": "Absolutely beautiful morning at our college campus! So grateful to be here studying.",
                "should_create": True,
                "expected_visibility": "PUBLIC",
                "expected_action": "ALLOW"
            },
            {
                "name": "Mildly Negative",
                "caption": "This professor's teaching style is really frustrating and not helping me learn",
                "should_create": True,
                "expected_visibility": ["PUBLIC", "HELD"],
                "expected_action": ["ALLOW", "ESCALATE"]
            },
            {
                "name": "Threatening Content", 
                "caption": "I hate everyone at this college and want to seriously hurt them all",
                "should_create": False,
                "expected_visibility": None,
                "expected_action": ["ESCALATE", "REJECT"]
            }
        ]
        
        for scenario in content_scenarios:
            status, data = await self.make_request('POST', '/content/posts', {
                "caption": scenario["caption"],
                "kind": "POST"
            }, self.user_token)
            
            if scenario["should_create"]:
                if status == 201:
                    post_data = data.get('post', {})
                    visibility = post_data.get('visibility')
                    moderation = post_data.get('moderation', {})
                    action = moderation.get('action')
                    
                    # Check visibility
                    expected_vis = scenario["expected_visibility"]
                    if isinstance(expected_vis, list):
                        vis_ok = visibility in expected_vis
                    else:
                        vis_ok = visibility == expected_vis
                    
                    # Check moderation action
                    expected_act = scenario["expected_action"]
                    if isinstance(expected_act, list):
                        act_ok = action in expected_act
                    else:
                        act_ok = action == expected_act
                    
                    if vis_ok and act_ok:
                        await self.log_result(f"Content Creation - {scenario['name']}", True,
                            f"Created - Visibility: {visibility}, Action: {action}")
                    else:
                        await self.log_result(f"Content Creation - {scenario['name']}", False,
                            f"Unexpected result - Visibility: {visibility}, Action: {action}")
                            
                elif status == 422:
                    # Content rejected by moderation
                    if 'moderation' in str(data).lower():
                        await self.log_result(f"Content Creation - {scenario['name']}", True,
                            "Content blocked by moderation (acceptable for borderline)")
                    else:
                        await self.log_result(f"Content Creation - {scenario['name']}", False,
                            f"Unexpected rejection: {data}")
                else:
                    await self.log_result(f"Content Creation - {scenario['name']}", False,
                        f"Unexpected status: {status}")
            else:
                # Should be rejected
                if status == 422 or status >= 400:
                    await self.log_result(f"Content Creation - {scenario['name']}", True,
                        f"Harmful content properly blocked (Status: {status})")
                elif status == 201:
                    post_data = data.get('post', {})
                    visibility = post_data.get('visibility')
                    if visibility == 'HELD':
                        await self.log_result(f"Content Creation - {scenario['name']}", True,
                            "Harmful content held for review")
                    else:
                        await self.log_result(f"Content Creation - {scenario['name']}", False,
                            "Harmful content not properly handled")
                else:
                    await self.log_result(f"Content Creation - {scenario['name']}", False,
                        f"Unexpected response: {status}")

    async def test_comment_moderation(self):
        """Test comment creation with moderation"""
        
        if not self.user_token:
            return
        
        # Create a test post first
        status, post_response = await self.make_request('POST', '/content/posts', {
            "caption": "Test post for comment moderation validation",
            "kind": "POST"
        }, self.user_token)
        
        if status != 201:
            await self.log_result("Comment Setup", False, f"Could not create test post: {status}")
            return
            
        post_id = post_response.get('post', {}).get('id')
        if not post_id:
            await self.log_result("Comment Setup", False, "No post ID in response")
            return
        
        # Test clean comment
        status, data = await self.make_request('POST', f'/content/{post_id}/comments', {
            "text": "Really great post! Thanks for sharing this wonderful content with us."
        }, self.user_token)
        
        if status == 201:
            await self.log_result("Comment Moderation - Clean", True, "Clean comment created")
        else:
            await self.log_result("Comment Moderation - Clean", False, f"Failed: {status}")
        
        # Test harmful comment  
        status, data = await self.make_request('POST', f'/content/{post_id}/comments', {
            "text": "You are a complete idiot and I will track you down and hurt you badly"
        }, self.user_token)
        
        if status >= 400:
            await self.log_result("Comment Moderation - Harmful", True, f"Harmful comment blocked: {status}")
        else:
            await self.log_result("Comment Moderation - Harmful", False, f"Not blocked: {status}")

    async def run_comprehensive_validation(self):
        """Execute comprehensive moderation system validation"""
        
        print("🚀 Tribe Moderation System - Comprehensive Validation")
        print("🎯 Focus: Provider-Adapter Pattern Refactor") 
        print("=" * 75)
        
        await self.setup_session()
        
        try:
            # Authentication
            print("\n🔐 User Authentication...")
            auth_success = await self.authenticate()
            
            # Health Checks
            print("\n🏥 Health & Configuration Checks...")
            await self.test_health_endpoints()
            
            # NEW MODERATION API ENDPOINTS (PRIMARY FOCUS)
            print("\n🛡️  New Moderation API Validation...")
            await self.test_moderation_config_endpoint()
            await self.test_moderation_check_endpoint()
            
            # CONTENT INTEGRATION TESTING (PRIMARY FOCUS) 
            if auth_success:
                print("\n📝 Content Creation Integration Testing...")
                await self.test_content_creation_with_moderation()
                
                print("\n💬 Comment Moderation Testing...")
                await self.test_comment_moderation()
            
        finally:
            await self.cleanup_session()
        
        self.print_comprehensive_summary()

    def print_comprehensive_summary(self):
        """Print detailed validation results"""
        
        print("\n" + "=" * 75)
        print("📊 MODERATION SYSTEM VALIDATION RESULTS")
        print("=" * 75)
        
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r['success'])
        failed = total - passed
        rate = (passed / total * 100) if total > 0 else 0
        
        print(f"📈 OVERALL METRICS:")
        print(f"   Total Tests: {total}")
        print(f"   Passed: {passed} ✅")
        print(f"   Failed: {failed} ❌") 
        print(f"   Success Rate: {rate:.1f}%")
        
        # Categorize by test areas
        categories = {
            "🏥 Health & Config": [r for r in self.test_results if any(x in r['test'] for x in ['Health', 'Config', 'Authentication'])],
            "🔍 Moderation APIs": [r for r in self.test_results if 'Moderation Check' in r['test']],
            "📝 Content Integration": [r for r in self.test_results if 'Content Creation' in r['test']],
            "💬 Comment Integration": [r for r in self.test_results if 'Comment' in r['test']],
            "🎫 Review Tickets": [r for r in self.test_results if 'Review Ticket' in r['test']]
        }
        
        print(f"\n📋 RESULTS BY CATEGORY:")
        for category, results in categories.items():
            if results:
                cat_passed = sum(1 for r in results if r['success'])
                cat_total = len(results)
                cat_rate = (cat_passed / cat_total * 100) if cat_total > 0 else 0
                status_icon = '✅' if cat_rate == 100 else '⚠️' if cat_rate >= 80 else '❌'
                print(f"   {category}: {cat_passed}/{cat_total} ({cat_rate:.0f}%) {status_icon}")
        
        # Failed tests details
        if failed > 0:
            print(f"\n❌ FAILED TEST ANALYSIS:")
            for result in self.test_results:
                if not result['success']:
                    print(f"   • {result['test']}: {result['details']}")
        
        # Key moderation system findings
        print(f"\n🎯 KEY MODERATION FINDINGS:")
        
        config_tests = [r for r in self.test_results if 'Config API' in r['test']]
        check_tests = [r for r in self.test_results if 'Moderation Check' in r['test']]
        content_tests = [r for r in self.test_results if 'Content Creation' in r['test']]
        
        if config_tests and all(r['success'] for r in config_tests):
            print("   ✅ Provider-Adapter configuration working perfectly")
        else:
            print("   ❌ Provider-Adapter configuration has issues")
            
        if check_tests:
            check_success = sum(1 for r in check_tests if r['success'])
            total_checks = len(check_tests)
            print(f"   {'✅' if check_success == total_checks else '⚠️'} Moderation API checks: {check_success}/{total_checks} passed")
            
        if content_tests:
            content_success = sum(1 for r in content_tests if r['success'])
            total_content = len(content_tests)
            print(f"   {'✅' if content_success == total_content else '⚠️'} Content integration: {content_success}/{total_content} passed")
        
        # Final assessment
        print(f"\n🏆 FINAL ASSESSMENT:")
        if rate >= 95:
            print(f"   🎉 EXCELLENT ({rate:.0f}%) - Moderation refactor is working brilliantly!")
            print("   ✅ Provider-Adapter pattern successfully implemented")
            print("   ✅ OpenAI + Fallback chain operational")  
            print("   ✅ Content integration working as expected")
        elif rate >= 85:
            print(f"   👍 GOOD ({rate:.0f}%) - Moderation system is functional with minor issues")
            print("   ✅ Core moderation APIs working")
            print("   ⚠️  Some integration issues detected")
        elif rate >= 70:
            print(f"   ⚠️  NEEDS WORK ({rate:.0f}%) - Significant issues in moderation system")
            print("   ⚠️  Major integration problems detected")
        else:
            print(f"   🚨 CRITICAL ({rate:.0f}%) - Moderation system has major failures")
            print("   ❌ Urgent fixes required")
        
        print(f"\n📝 SUMMARY FOR MAIN AGENT:")
        if rate >= 90:
            print("   Provider-Adapter moderation refactor is successful and ready for production!")
        else:
            print("   Moderation refactor needs attention - see failed tests above for details.")

async def main():
    validator = TribeModerationValidator()
    await validator.run_comprehensive_validation()

if __name__ == "__main__":
    asyncio.run(main())