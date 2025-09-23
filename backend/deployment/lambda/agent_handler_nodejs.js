/**
 * AWS Lambda Handler for Node.js RESPONSE_STREAM Mode
 * Uses correct awslambda.streamifyResponse API for Lambda Function URL streaming
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configure logging
const logger = {
    info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
    error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
    warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} ${msg}`)
};

/**
 * Streaming handler using correct AWS Lambda API
 * Note: Parameter order is (event, responseStream, context) for streamifyResponse
 */
const streamingHandler = async (event, responseStream, context) => {
    logger.info('Node.js RESPONSE_STREAM handler invoked');
    logger.info(`Event keys: ${Object.keys(event).join(', ')}`);
    logger.info(`HTTP Method: ${event.requestContext?.http?.method || 'UNKNOWN'}`);

    try {
        // Create HTTP response stream with correct headers using awslambda.HttpResponseStream.from()
        const httpResponseStream = awslambda.HttpResponseStream.from(responseStream, {
            statusCode: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
            }
        });

        // Parse request
        let parsedBody;
        if (event.body) {
            try {
                parsedBody = JSON.parse(event.body);
            } catch (e) {
                const queryParams = event.queryStringParameters || {};
                const prompt = queryParams.prompt;
                if (!prompt) {
                    httpResponseStream.write('data: {"error": "Missing request body and prompt query parameter"}\n\n');
                    httpResponseStream.end();
                    return;
                }
                parsedBody = { prompt: prompt };
            }
        } else {
            parsedBody = event;
        }

        const prompt = parsedBody.prompt || '';
        logger.info(`Extracted prompt: '${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}'`);

        if (!prompt) {
            httpResponseStream.write('data: {"error": "Missing required field: prompt"}\n\n');
            httpResponseStream.end();
            return;
        }

        // Send SSE response chunks
        httpResponseStream.write('data: {"message": "Starting Node.js RESPONSE_STREAM execution"}\n\n');

        // Execute Python agent with streaming
        const startTime = Date.now();

        try {
            // Check if generated_agent.py exists
            const agentPath = path.join(__dirname, 'generated_agent.py');
            if (!fs.existsSync(agentPath)) {
                httpResponseStream.write('data: {"error": "generated_agent.py not found"}\n\n');
                httpResponseStream.end();
                return;
            }

            // Prepare arguments for Python execution
            const args = ['generated_agent.py', '--user-input', prompt];

            // Add input_data if provided
            if (parsedBody.input_data) {
                args.push('--input-data', JSON.stringify(parsedBody.input_data));
            }

            logger.info(`Executing Python agent: python ${args.join(' ')}`);

            // Use full Python path in Lambda environment
            const pythonCmd = '/var/lang/bin/python3';
            logger.info(`Using Python command: ${pythonCmd}`);
            const pythonProcess = spawn(pythonCmd, args, {
                cwd: __dirname,
                stdio: ['pipe', 'pipe', 'pipe'],
                env: {
                    ...process.env,
                    PYTHONPATH: __dirname,
                    PYTHONUNBUFFERED: '1'
                }
            });

            let hasOutput = false;

            // Handle stdout (streaming output)
            pythonProcess.stdout.on('data', (data) => {
                const output = data.toString();
                logger.info(`Python stdout: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`);

                // Send each line as SSE data
                const lines = output.split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        httpResponseStream.write(`data: ${line.trim()}\n\n`);
                        hasOutput = true;
                    }
                }
            });

            // Handle stderr
            pythonProcess.stderr.on('data', (data) => {
                const error = data.toString();
                logger.error(`Python stderr: ${error}`);
                httpResponseStream.write(`data: Error: ${error.trim()}\n\n`);
            });

            // Handle process completion
            pythonProcess.on('close', (code) => {
                const executionTime = (Date.now() - startTime) / 1000;
                logger.info(`Python process exited with code ${code}, execution time: ${executionTime}s`);

                if (code === 0) {
                    if (!hasOutput) {
                        httpResponseStream.write('data: Agent execution completed (no output)\n\n');
                    }
                } else {
                    httpResponseStream.write(`data: Error: Python process exited with code ${code}\n\n`);
                }

                // Send completion metadata
                httpResponseStream.write(`data: ${JSON.stringify({
                    function_type: 'nodejs_stream',
                    invoke_mode: 'RESPONSE_STREAM',
                    max_response_size: '200MB',
                    execution_time: executionTime,
                    exit_code: code,
                    execution_context: {
                        function_name: context.functionName,
                        function_version: context.functionVersion,
                        request_id: context.awsRequestId,
                        memory_limit: context.memoryLimitInMB,
                        remaining_time: context.getRemainingTimeInMillis()
                    }
                })}\n\n`);

                // Send completion signal
                httpResponseStream.write('data: [DONE]\n\n');
                httpResponseStream.end();
            });

        } catch (execError) {
            logger.error(`Failed to execute Python agent: ${execError.message}`);
            httpResponseStream.write(`data: Error: Failed to execute agent: ${execError.message}\n\n`);
            httpResponseStream.end();
        }

        logger.info('Streaming execution completed');

    } catch (error) {
        const errorMsg = `Handler execution failed: ${error.message}`;
        logger.error(`${errorMsg}\n${error.stack}`);

        // Create error response stream if httpResponseStream wasn't created yet
        try {
            const errorResponseStream = awslambda.HttpResponseStream.from(responseStream, {
                statusCode: 500,
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Access-Control-Allow-Origin': '*'
                }
            });
            errorResponseStream.write(`data: {"error": "${errorMsg}"}\n\n`);
            errorResponseStream.end();
        } catch (streamError) {
            logger.error(`Failed to create error response stream: ${streamError.message}`);
        }
    }
};

// Export using correct global awslambda.streamifyResponse
exports.handler = awslambda.streamifyResponse(streamingHandler);