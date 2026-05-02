# School Schedule Web

NEIS Open API로 학교 시간표와 급식 정보를 조회하고, Discord 봇과 연동해 사용자별 학교 설정을 저장하는 포트폴리오용 웹 애플리케이션입니다.

## 주요 기능

- 학교명 검색, 학년/반 설정
- 개인정보처리방침 및 이용약관 전문 확인 후 회원가입 진행
- Firebase Authentication 휴대폰 번호 인증 및 Google 로그인
- 웹 회원가입 즉시 저장
- Firebase 인증 기반 로그인 및 회원정보 조회
- Discord 봇 인증용 6자리 임시 토큰 발급
- MongoDB 4.0 호환 데이터 저장
- 개인정보 단방향 암호화 저장
- 관리자 페이지용 공지사항, 트래픽, 시스템 모니터링 API


## 기술 스택

- Node.js 18+
- Express 4
- MongoDB 4.0
- Mongoose 8.15.x (MongoDB 4.0 호환을 위해 8.16 미만으로 고정)
- Firebase Authentication Phone Auth / Google Sign-In
- NEIS Open API


## 보안 설계 (Security Architecture)

본 프로젝트는 사용자의 민감한 정보를 보호하기 위해 다음과 같은 보안 계층을 적용하였습니다.

### 1. 데이터 암호화 및 비식별화
**민감 정보 암호화** : 모든 개인정보는 업계 표준 암호화 라이브러리를 사용하여 **비가독성 데이터(Ciphertext)**로 변환 후 저장됩니다. 복호화에 필요한 키는 소스 코드와 완전히 분리된 환경 변수(Secret Manager 등)를 통해 관리됩니다.
* **식별자 익명화**: Discord ID, Firebase UID, 전화번호 등 고유 식별값은 직접 저장하지 않고, **단방향 키 기반 해시(Keyed-Hash)** 처리를 통해 원본을 유추할 수 없는 고유 식별값으로 관리합니다.
* **데이터 무결성**: 암호화 과정에서 인증 태그를 포함하여 데이터의 변조 여부를 검증하는 방식을 채택했습니다.

### 2. 인증 및 세션 보안
* **일회성 인증 토큰**: Discord 연동을 위한 6자리 토큰은 일회성으로만 유효하며, **TTL(Time-To-Live)** 설정을 통해 DB 내에서 지정된 시간 후 자동으로 영구 삭제됩니다.
* **이중 검증 프로세스**: 클라이언트에서 전달받은 Firebase ID Token은 서버 측에서 Firebase Auth REST API를 통해 유효성을 재검증하는 Cross-Verification 과정을 거칩니다.

### 3. 장애 복구 및 관리
* **복호화 불가 원칙**: 암호화 키 분실 시 기존 데이터를 복구할 수 없는 강력한 보안 정책을 유지하고 있습니다. 운영 환경에서는 반드시 `DATA_ENCRYPTION_KEY`를 안전하게 백업 및 관리해야 합니다.
* **최소 권한 원칙**: DB 계정은 해당 서비스에 필요한 최소한의 권한(`readWrite`)만 부여하여 운영합니다.

---

## 환경 변수 설정

`.env.example` 파일을 참고하여 프로젝트 루트에 `.env` 파일을 생성하세요.

```bash
# 보안 강화를 위한 32바이트 기반 암호화 시드 생성 예시
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

필요한 주요 환경 변수:

```env
# Database & Security
MONGO_URI=mongodb://school_app:password@localhost:27017/discord_bot
DATA_ENCRYPTION_KEY= # 위에서 생성한 base64 키

# Firebase Web App Configuration
FIREBASE_WEB_API_KEY=<Firebase web config apiKey>
FIREBASE_AUTH_DOMAIN=<Firebase web config authDomain>
FIREBASE_PROJECT_ID=school-scadule-web
FIREBASE_APP_ID=<Firebase web config appId, e.g. 1:198944642051:web:...>
FIREBASE_MESSAGING_SENDER_ID=198944642051
```

## Firebase 설정

1. Firebase Console에서 프로젝트를 생성합니다.
2. Authentication > Sign-in method에서 Phone provider와 Google provider를 활성화합니다.
3. Project settings > General에서 Web App을 추가합니다.
4. Web config 값을 `.env`에 입력합니다.
5. Authentication > Settings > Authorized domains에 `localhost`, `127.0.0.1`, 배포 도메인을 등록합니다. 로컬 Google 인증은 `http://localhost:8000/register` 접속을 권장합니다.
6. 개발 중에는 Authentication > Phone numbers for testing에 테스트 번호를 등록하면 SMS 과금 없이 확인할 수 있습니다.
   Firebase 테스트 번호는 실제 SMS가 발송되지 않으며, Console에 등록한 6자리 테스트 인증번호를 입력해야 합니다.

필요한 값:

```env
FIREBASE_WEB_API_KEY=<Firebase web config apiKey>
FIREBASE_AUTH_DOMAIN=<Firebase web config authDomain>
FIREBASE_PROJECT_ID=school-scadule-web
FIREBASE_APP_ID=<Firebase web config appId, not the sender ID>
FIREBASE_MESSAGING_SENDER_ID=198944642051
```

## MongoDB 설정

앱 전용 계정을 만들고 `discord_bot` DB에만 권한을 주는 구성을 권장합니다.

```js
use discord_bot

db.createUser({
  user: "example_ID",
  pwd: "example_strong_password",
  roles: [{ role: "readWrite", db: "discord_bot" }]
})
```

서버 시작 시 필요한 인덱스가 자동 생성됩니다.

- `notices.id` unique
- `notices.createdAt`
- `users.discordIdHash` unique sparse
- `users.firebaseUidHash` unique sparse
- `users.phoneHash`
- `users.emailHash`
- `pendingtokens.token` unique
- `pendingtokens.expiresAt` TTL

## 실행

```bash
npm install
node server.js
```

기본 포트는 `8000`입니다.

- 사용자 화면: `http://localhost:8000`
- 로그인: `http://localhost:8000/login`
- 회원가입: `http://localhost:8000/register`
- 개인정보처리방침: `http://localhost:8000/privacy`
- 이용약관: `http://localhost:8000/terms`
- 상태 확인: `http://localhost:8000/health`

## 회원가입 흐름

1. 학교를 검색하고 학년/반을 입력합니다.
2. 개인정보처리방침과 이용약관 전문을 끝까지 읽습니다.
3. Firebase 휴대폰 번호 인증 또는 Google 인증을 완료합니다.
4. 개인정보 수집 및 이용, 이용약관 동의 후 가입을 완료합니다.
5. `웹에서 바로 가입`을 누르면 Firebase UID 기준으로 사용자 설정이 즉시 암호화 저장됩니다.
6. Discord 봇과도 연동하려면 `Discord 연동 토큰 발급`을 누르고 발급된 6자리 토큰을 봇 명령어에 입력합니다.
7. 봇이 `/api/verify`를 호출하면 기존 웹 가입 계정이 있으면 같은 Firebase UID 기준으로 Discord ID가 연결됩니다.

## 로그인 흐름

1. `/login`에서 Google 또는 SMS 인증을 완료합니다.
2. 서버가 Firebase ID token을 검증한 뒤 Firebase UID 기준으로 회원정보를 조회합니다.
3. 회원정보가 있으면 학교 설정을 브라우저에 반영하고 메인 페이지로 이동합니다.
4. 회원정보가 없으면 `회원정보가 없습니다.`와 `회원가입 페이지로 이동할까요?` 안내를 표시하고 예/아니오 선택을 받습니다.

## 참고 문서

- [Firebase Phone Auth for Web](https://firebase.google.com/docs/auth/web/phone-auth)
- [Firebase Google Sign-In for Web](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase Auth REST API](https://firebase.google.com/docs/reference/rest/auth)
- [Firebase ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

## 개발용 테스트 휴대폰 인증

Firebase Web App 설정이 아직 없거나 SMS 인증 없이 API 흐름만 확인해야 할 때는 `.env`에서 개발 전용 테스트 토큰을 켤 수 있습니다.

```env
ENABLE_TEST_PHONE_AUTH=true
PHONE_AUTH_TEST_TOKEN=local_test_token
PHONE_AUTH_TEST_UID=test-phone-user
PHONE_AUTH_TEST_PHONE=+821012345678
```

이 기능은 `NODE_ENV=production`에서는 동작하지 않도록 막혀 있습니다. 실제 배포에서는 반드시 `ENABLE_TEST_PHONE_AUTH=false`로 두고 Firebase Phone Auth ID token만 사용하세요.
