pipeline {
    agent any

    environment {
        SONAR_HOST_URL    = 'http://host.docker.internal:9000'
        SONAR_PROJECT_KEY = 'k6-1'
        REPORT_DIR        = 'security-reports'
        TOOLS_BIN         = "${WORKSPACE}/.tools/bin"
        PATH              = "${WORKSPACE}/.tools/bin:${HOME}/.local/bin:${PATH}"

        // NEW: container image names
        FRONTEND_IMAGE    = "k6-frontend:${BUILD_NUMBER}"
        BACKEND_IMAGE     = "k6-backend:${BUILD_NUMBER}"
    }

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    stages {

        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Prepare Report Dir') {
            steps {
                sh '''
                    rm -rf "${REPORT_DIR}"
                    mkdir -p "${REPORT_DIR}"
                '''
            }
        }

        stage('Install Scan Tools') {
            steps {
                sh '''
                    set -e
                    mkdir -p "${TOOLS_BIN}"

                    echo "--- Ensuring pip ---"
                    if ! python3 -m pip --version >/dev/null 2>&1; then
                        echo "pip module missing, bootstrapping via get-pip.py"
                        curl -sSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py
                        python3 /tmp/get-pip.py --user --break-system-packages
                    fi
                    python3 -m pip --version

                    echo "--- Installing Semgrep ---"
                    python3 -m pip install --user --quiet --break-system-packages --upgrade semgrep
                    semgrep --version

                    echo "--- Installing Trivy ---"
                    if [ ! -x "${TOOLS_BIN}/trivy" ]; then
                        curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh \
                            | sh -s -- -b "${TOOLS_BIN}"
                    fi
                    trivy --version
                '''
            }
        }

        stage('Check Tools') {
            steps {
                sh '''
                    echo "Checking required tools..."

                    git --version || true
                    python3 --version || true
                    pip --version || true
                    sonar-scanner --version || true
                    trivy --version || true
                    semgrep --version || true
                    docker --version || true

                    echo "Workspace:"
                    pwd
                    ls -la
                '''
            }
        }

        stage('Semgrep Scan') {
            steps {
                sh '''
                    echo "Starting Semgrep scan..."

                    semgrep \
                        --config=auto \
                        --error \
                        --exclude='**/reports/**' \
                        --exclude='**/venv/**' \
                        --exclude='**/generated_scripts/**' \
                        --exclude='**/recorder_sessions/**' \
                        --exclude='**/node_modules/**' \
                        --json \
                        --output="${REPORT_DIR}/semgrep-report.json" \
                        .
                '''
            }
        }

        stage('Trivy Scan') {
            steps {
                sh '''
                    echo "Starting Trivy scan..."

                    trivy fs \
                        --scanners vuln,secret,misconfig \
                        --exit-code 1 \
                        --severity HIGH,CRITICAL \
                        --skip-dirs reports \
                        --skip-dirs Backend/reports \
                        --skip-dirs Backend/venv \
                        --skip-dirs Backend/generated_scripts \
                        --skip-dirs Backend/recorder_sessions \
                        --skip-dirs Frontend/k6-UI/node_modules \
                        --skip-dirs Frontend/k6-UI/dist \
                        --format json \
                        --output "${REPORT_DIR}/trivy-report.json" \
                        . || true
                '''
            }
        }

        stage('SonarQube Scan') {
            steps {
                // NOTE: credentialsId must be the ID of a "Secret text" credential
                // stored in Jenkins (Manage Jenkins -> Credentials), NOT the raw token.
                // Create one with an ID like 'sonarqube-token' and paste the token as its value.
                withCredentials([
                    string(
                        credentialsId: 'sonarqube-token',
                        variable: 'SONAR_TOKEN'
                    )
                ]) {
                    // 'SonarQubeServer' must exactly match the Name configured under
                    // Manage Jenkins -> System -> SonarQube servers.
                    withSonarQubeEnv('SonarQubeServer') {
                        script {
                            // 'SonarScanner' must exactly match the Name configured under
                            // Manage Jenkins -> Tools -> SonarQube Scanner installations.
                            def scannerHome = tool 'SonarScanner'
                            env.SCANNER_HOME = scannerHome
                        }

                        // Single-quoted sh block: the shell (not Groovy) resolves these
                        // variables at runtime, so SONAR_TOKEN is never baked into the
                        // literal command string and Jenkins can mask it properly in logs.
                        sh '''
                            echo "Starting SonarQube scan..."

                            "${SCANNER_HOME}/bin/sonar-scanner" \
                                -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
                                -Dsonar.sources=Backend,Frontend/k6-UI/src,db_helper.py \
                                -Dsonar.exclusions="**/reports/**,**/venv/**,**/generated_scripts/**,**/recorder_sessions/**,**/node_modules/**,**/uploads/**,**/uploaded_csv/**,**/dist/**,**/coverage/**" \
                                -Dsonar.host.url="${SONAR_HOST_URL}" \
                                -Dsonar.token="${SONAR_TOKEN}"
                        '''
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 20, unit: 'MINUTES') {
                    waitForQualityGate abortPipeline: false
                }
            }
        }

        stage('Fetch SonarQube Issues') {
            steps {
                // Same fix here: use the real Jenkins credential ID, not a raw token/string.
                withCredentials([
                    string(
                        credentialsId: 'sonarqube-token',
                        variable: 'SONAR_TOKEN'
                    )
                ]) {
                    sh '''
                        echo "Fetching SonarQube issues..."

                        PAGE=1
                        TOTAL=1
                        PAGE_SIZE=500
                        REPORT="${REPORT_DIR}/sonarqube-report.json"
                        echo '{"issues":[],"total":0}' > "${REPORT}"

                        while [ $(((PAGE - 1) * PAGE_SIZE)) -lt "${TOTAL}" ]; do
                            curl --fail --silent --show-error --get -u "${SONAR_TOKEN}:" \
                                --data-urlencode "componentKeys=${SONAR_PROJECT_KEY}" \
                                --data-urlencode "ps=${PAGE_SIZE}" \
                                --data-urlencode "p=${PAGE}" \
                                "${SONAR_HOST_URL}/api/issues/search" \
                                -o "${REPORT_DIR}/sonarqube-page.json"

                            TOTAL=$(jq -r '.total // 0' "${REPORT_DIR}/sonarqube-page.json")
                            jq -s '{issues: (.[0].issues + .[1].issues), total: .[1].total}' \
                                "${REPORT}" "${REPORT_DIR}/sonarqube-page.json" \
                                > "${REPORT_DIR}/sonarqube-merged.json"
                            mv "${REPORT_DIR}/sonarqube-merged.json" "${REPORT}"
                            PAGE=$((PAGE + 1))
                        done

                        rm -f "${REPORT_DIR}/sonarqube-page.json"
                    '''
                }
            }
        }

        // ================= NEW: Container image vulnerability scanning =================

        stage('Docker Availability Check') {
            steps {
                sh '''
                    docker --version
                    docker info > /dev/null || { echo "Jenkins cannot reach the Docker daemon"; exit 1; }
                '''
            }
        }

        stage('Build Docker Images') {
            steps {
                sh '''
                    echo "Building frontend image..."
                    docker build -t "${FRONTEND_IMAGE}" ./Frontend/k6-UI

                    echo "Building backend image..."
                    docker build -f ./Backend/dockerfile -t "${BACKEND_IMAGE}" ./Backend
                '''
            }
        }

stage('Trivy Image Scan - Frontend') {
    steps {
        sh '''
            echo "Scanning frontend image..."

            trivy image \
                --scanners vuln \
                --severity HIGH,CRITICAL \
                --exit-code 0 \
                --format json \
                --output "${REPORT_DIR}/trivy-frontend-image.json" \
                "${FRONTEND_IMAGE}"

            echo "Frontend image scan completed."
        '''
    }
}

stage('Trivy Image Scan - Backend') {
    steps {
        sh '''
            echo "Scanning backend image..."

            trivy image \
                --scanners vuln \
                --severity HIGH,CRITICAL \
                --exit-code 0 \
                --format json \
                --output "${REPORT_DIR}/trivy-backend-image.json" \
                "${BACKEND_IMAGE}"

            echo "Backend image scan completed."
        '''
    }
}

        // ================================================================================

        stage('Generate HTML Report') {
            steps {
                sh '''
                    echo "Generating HTML report..."

                    python3 generate_report.py "${REPORT_DIR}"
                '''
            }
        }

        stage('Archive Reports') {
            steps {
                archiveArtifacts(
                    artifacts: "${REPORT_DIR}/*, dashboard.html",
                    fingerprint: true,
                    allowEmptyArchive: true
                )
            }
        }

        stage('Security Quality Gate - Container Images') {
    steps {
        sh '''
            echo "Checking container image vulnerabilities..."

            for REPORT in \
                "${REPORT_DIR}/trivy-frontend-image.json" \
                "${REPORT_DIR}/trivy-backend-image.json"
            do
                if [ ! -f "$REPORT" ]; then
                    echo "ERROR: Report not found: $REPORT"
                    exit 1
                fi

                COUNT=$(jq '[
                    .Results[]?.Vulnerabilities[]?
                    | select(
                        .Severity == "HIGH"
                        or .Severity == "CRITICAL"
                    )
                ] | length' "$REPORT")

                echo "$REPORT: $COUNT HIGH/CRITICAL vulnerabilities"

                if [ "$COUNT" -gt 0 ]; then
                    echo "Vulnerabilities found:"
                    jq -r '
                        .Results[]?.Vulnerabilities[]?
                        | select(
                            .Severity == "HIGH"
                            or .Severity == "CRITICAL"
                        )
                        | [
                            .VulnerabilityID,
                            .PkgName,
                            .InstalledVersion,
                            .Severity,
                            (.Title // "No title")
                        ]
                        | @tsv
                    ' "$REPORT"

                    echo "Security quality gate FAILED."
                    exit 1
                fi
            done

            echo "Security quality gate PASSED."
        '''
    }
}
    }

    post {
        always {
            // NEW: clean up the images built for scanning
            sh 'docker rmi "${FRONTEND_IMAGE}" "${BACKEND_IMAGE}" || true'
            echo 'Security scan pipeline finished. See archived artifacts for JSON + HTML reports.'
        }

        success {
            echo 'Pipeline completed successfully.'
        }

        failure {
            echo 'Pipeline failed — check the stage logs above.'
        }
    }
}
