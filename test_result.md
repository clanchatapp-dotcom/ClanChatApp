#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
user_problem_statement: "ClanChat rebuild — React(Vite+TS) SPA + FastAPI backend, Supabase Google auth, Supabase JWT-protected API, Supabase Storage media, real-time group chat. Firebase removed."

backend:
  - task: "Health check GET /api/"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Returns ok/service/time."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - Returns {ok:true, service:'clanchat', time:ISO8601}. Status 200."

  - task: "Sandbox dev login POST /api/dev/token"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Mints a real Supabase-compatible HS256 JWT signed with SUPABASE_JWT_SECRET. Body {name}. Returns access_token + user. Deterministic user id per email (uuid5). Use this token as Bearer for all protected routes."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - Returns access_token (367 chars JWT) + user object. Deterministic: same name returns same user id (e9c356f8-edcd-5ac3-b95b-9a5d97193bf5 for 'Tester'). Token is valid HS256 JWT with aud=authenticated."

  - task: "Supabase JWT auth dependency (GET /api/me)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "HS256, aud=authenticated. Must 200 with valid token from /api/dev/token; must 401 for missing header, malformed token, and wrong/garbage signature."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - All scenarios tested: (a) Valid token -> 200 with user profile, (b) No Authorization header -> 401 'Missing Bearer token', (c) Malformed token 'abc.def.ghi' -> 401 'Invalid token', (d) Valid format but wrong signature -> 401 'Signature verification failed'."

  - task: "Clans: list/create/join-by-code/join-by-id"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "GET /api/clans (seeded General+Announcements). POST /api/clans creates + returns code. POST /api/clans/join {code}. POST /api/clans/{id}/join. member_count/is_member flags."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - All scenarios tested: (a) GET /api/clans returns seeded 'General' and 'Announcements' with member_count and is_member fields, (b) POST /api/clans creates clan with 6-char code (e.g., 'EFC3A3'), (c) POST /api/clans/join with valid code joins successfully (is_member=true), (d) POST /api/clans/{id}/join joins by id successfully, (e) Invalid code returns 404 'No clan with that code'."

  - task: "Messages: history + send + auto-join on open"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "GET /api/clans/{id}/messages returns history (and auto-joins caller). POST /api/clans/{id}/messages {text} persists + broadcasts. Empty message -> 400."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - All scenarios tested: (a) GET /api/clans/{id}/messages returns message array and auto-joins caller, (b) POST /api/clans/{id}/messages with text creates message with id/user_name/created_at fields, (c) POST with empty text and no media_url returns 400 'Empty message'."

  - task: "Supabase Storage upload POST /api/upload"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Multipart file -> uploads to Supabase bucket clanchat-media (service role) -> returns {path, signed_url}. signed_url should be an HTTPS URL that returns the file (GET 200). Requires auth."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - All scenarios tested: (a) POST /api/upload without auth returns 401, (b) POST /api/upload with auth and PNG file returns {path, signed_url} where signed_url is HTTPS URL, (c) GET signed_url returns 200 with file content (70 bytes PNG verified). Real Supabase Storage integration working."

  - task: "WebSocket /api/ws/{clan_id} realtime broadcast"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Connect with ?token=JWT. Rejects (close 1008) without/with invalid token. On POST message to a clan, all connected sockets for that clan receive {type:message, message:{...}}."
        -working: true
        -agent: "testing"
        -comment: "✅ PASS - All scenarios tested: (a) Connection without token is rejected/closed, (b) Connection with invalid token is rejected/closed, (c) Connection with valid token succeeds and receives broadcast when message is posted via REST API. Broadcast format: {type:'message', message:{id, text, user_name, created_at}}. WebSocket accessible through ingress at wss://.../api/ws/{clan_id}."

frontend:
  - task: "Login + Google/dev auth + real-time Chat UI"
    implemented: true
    working: "NA"
    file: "src/pages/Chat.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Not yet tested by agent (awaiting user go-ahead)."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Backend is FastAPI on :8001, proxied at /api via the external URL. To authenticate: POST /api/dev/token {name:'Tester'} -> use returned access_token as 'Authorization: Bearer'. Please test all backend tasks incl. the real Supabase Storage upload (verify signed_url is fetchable) and the WebSocket broadcast."
    -agent: "testing"
    -message: "✅ ALL BACKEND TESTS PASSED (20/20). Tested: health check, dev token (deterministic), JWT auth (all scenarios), clans (list/create/join by code/join by id/bad code), messages (history/send/auto-join/empty validation), Supabase Storage upload (with/without auth, signed URL verified), WebSocket (no token/invalid token/valid token with broadcast). All endpoints working correctly. Real Supabase Storage integration confirmed. WebSocket realtime broadcast working through ingress. Backend is production-ready."
