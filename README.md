# Law Monitor

국회에 제출된 개정안을 모니터링하는 정적 HTML 대시보드입니다. 발의 의원, 발의 날짜, 주요 내용, 심사 현황은 국회 열린국회정보 API로 갱신하고, 사업영향과 중요도는 규칙 파일로 보정합니다.

## 로컬 실행

```bash
python3 -m http.server 5173
```

브라우저에서 `http://localhost:5173`을 엽니다.

## API 데이터 갱신

국회 열린국회정보 API 키가 필요합니다.

```bash
OPEN_ASSEMBLY_API_KEY=발급받은키 node scripts/fetch-open-assembly.mjs
```

키를 터미널에 남기지 않고 입력하려면 아래 명령을 사용합니다.

```bash
npm run fetch:bills:prompt
```

이 명령은 API 키를 숨김 입력으로 받아 현재 실행 프로세스에만 전달합니다. 입력한 키는 파일에 저장되지 않습니다.
기본값은 22대 국회입니다. 다른 대수를 조회하려면 아래처럼 실행합니다.

```bash
BILL_ERACO=21 npm run fetch:bills:prompt
```

특정 의안번호만 테스트하려면 아래처럼 실행합니다.

```bash
BILL_NO=2219094 npm run fetch:bills:prompt
```

여러 의안을 계속 추적하려면 `data/watchlist.json`에 의안번호를 추가합니다.

```json
{
  "billNos": [
    "2219094",
    "다른의안번호"
  ]
}
```

그 다음 아래 명령으로 `data/bills.json`을 다시 생성합니다.

```bash
npm run fetch:bills:prompt
```

일회성으로 여러 의안번호를 테스트하려면 아래처럼 쉼표로 넘길 수 있습니다.

```bash
BILL_NOS=2219094,다른의안번호 npm run fetch:bills:prompt
```

대시보드 화면에서도 의안번호를 추가하거나 삭제할 수 있습니다. 의안번호는 7자리 숫자만 허용하며, 쉼표, 공백, 줄바꿈으로 여러 건을 한 번에 입력할 수 있습니다. 추가한 의안번호가 현재 배포 데이터에 없으면 브라우저가 국회 API를 직접 조회합니다. 이때 API 키를 묻는 창이 뜨며, 입력한 키는 현재 브라우저의 `localStorage`에만 저장됩니다. API로 불러온 의안 데이터도 같은 브라우저에 저장되어 새로고침 후에도 바로 표시됩니다.

정적 GitHub Pages에서는 화면에서 추가/삭제한 의안번호와 브라우저 API 키가 같은 브라우저에서만 유지됩니다. 다른 팀원이나 다른 기기에는 공유되지 않습니다. 팀 전체 목록으로 반영하려면 `data/watchlist.json`을 수정하고 GitHub에 push해야 합니다. 국회 API가 브라우저 직접 호출을 막는 경우에는 화면 자동 조회가 실패할 수 있으며, 그때는 GitHub Actions 갱신 방식으로 반영해야 합니다.

기본 법안 목록 endpoint는 `https://open.assembly.go.kr/portal/openapi/ALLBILLV2`입니다. 제안이유 및 주요내용은 `https://open.assembly.go.kr/portal/openapi/BPMBILLSUMMARY`에서 보강합니다.

```bash
OPEN_ASSEMBLY_API_BASE=https://open.assembly.go.kr/portal/openapi \
OPEN_ASSEMBLY_API_KEY=발급받은키 \
BILL_ERACO=22 \
node scripts/fetch-open-assembly.mjs
```

국회 API 쪽에서 확인해야 할 점:

- `OOWY4R001216HX11440`은 공공데이터포털/열린국회정보의 통합 API 서비스 페이지 ID이고, 실제 데이터 목록 호출은 `ALLBILLV2` 같은 세부 endpoint를 사용합니다.
- 22대 국회 필터는 기본적으로 `ERACO=22`를 사용합니다.
- API 키는 브라우저에 노출하지 않고 GitHub Actions Secret `OPEN_ASSEMBLY_API_KEY`에 저장합니다.
- 실제 키로 첫 실행 후 응답 필드가 다르면 `scripts/fetch-open-assembly.mjs`의 후보 필드명을 보정해야 합니다.

## 사업영향/중요도 조정

- `data/impact-rules.json`: 키워드 기반 자동 분류 규칙
- `data/impact-overrides.json`: 법안 ID 또는 의안번호 기준 수동 보정. `importance`와 `oc`는 수동 입력사항입니다.

예시:

```json
{
  "2200001": {
    "oc": "검토",
    "impactArea": "결제/핀테크",
    "businessImpact": "전자금융 약관과 정산 프로세스 검토 필요",
    "importance": "high"
  }
}
```

## GitHub Pages 배포

1. GitHub에 새 저장소를 만듭니다.
2. 이 폴더를 해당 저장소로 push합니다.
3. 저장소 Settings > Secrets and variables > Actions에서 `OPEN_ASSEMBLY_API_KEY` Secret을 추가합니다.
4. 필요하면 Actions Variables에 `BILL_ERACO`, `BILL_KEYWORDS`, `MAX_PAGES`를 추가합니다.
5. Settings > Pages에서 Source를 `GitHub Actions`로 설정합니다.
6. Actions 탭에서 `Update bills and deploy Pages` workflow를 수동 실행하거나 push를 기다립니다.
7. 배포가 끝나면 workflow summary 또는 Pages 설정 화면의 URL을 팀원에게 공유합니다.

## 데이터 출처

- 공공데이터포털의 `국회 국회사무처_의안정보 통합 API`
- 열린국회정보 Open API
