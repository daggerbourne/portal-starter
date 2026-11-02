# URL patterns

# target

main-url https://main--portal-starter.netlify.app/portal-starter/ main
auth-test-url https://auth-test--portal-starter.netlify.app/portal-starter/ auth-test
preview-url https://deploy-preview-5--portal-starter.netlify.app/portal-starter/ preview
bare-path https://main--portal-starter.netlify.app/portal-starter main
root-rejected https://main--portal-starter.netlify.app/ rejected-host
other-host-rejected https://example.com/portal-starter/ rejected-host
http-rejected http://main--portal-starter.netlify.app/portal-starter/ rejected-host
query-rejected https://main--portal-starter.netlify.app/portal-starter/?x=1 rejected-host

# login

login-url https://app.netlify.com/login app.netlify.com/login
sso-url https://app.netlify.com/sso?from=site app.netlify.com/sso
signup-url https://app.netlify.com/signup app.netlify.com/signup
access-url https://app.netlify.com/access/continue app.netlify.com/access

# page

login-page 302 https://app.netlify.com/login netlify-login
sso-page 200 https://app.netlify.com/sso netlify-login
status-401 401 https://main--portal-starter.netlify.app/portal-starter/ netlify-login
hello 200 https://main--portal-starter.netlify.app/portal-starter/ app
preview-hello 200 https://deploy-preview-5--portal-starter.netlify.app/portal-starter/ app
