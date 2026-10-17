@echo off
cd /d "%~dp0artifacts\3d-game\syndicate"
echo SYNDICATE portal: http://127.0.0.1:5198
echo Admin: http://127.0.0.1:5198/admin/login
echo Agent: http://127.0.0.1:5198/agent/login
echo Member: http://127.0.0.1:5198/member/login
echo Complete the entrance game first. Only members can sign up.
echo Agent access unlocks after own verification and two approved direct members.
echo Admin login is for the existing owner. There is no admin or agent signup.
node scripts\run-framework.mjs dev --port 5198 --hostname 127.0.0.1
pause
