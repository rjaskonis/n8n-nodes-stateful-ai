"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatefulAIAgent = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const runnables_1 = require("@langchain/core/runnables");
const prompts_1 = require("@langchain/core/prompts");
const output_parsers_1 = require("@langchain/core/output_parsers");
const agents_1 = require("langchain/agents");
class StatefulAIAgent {
    constructor() {
        this.description = {
            displayName: 'Stateful AI Agent',
            name: 'statefulAgent',
            icon: 'file:statefulaiagent.svg',
            group: ['transform'],
            version: 1,
            subtitle: '={{$parameter["userMessage"]}}',
            description: 'Advanced AI agent with state management and tool calling capabilities',
            defaults: {
                name: 'Stateful AI Agent',
            },
            inputs: [
                n8n_workflow_1.NodeConnectionTypes.Main,
                {
                    type: n8n_workflow_1.NodeConnectionTypes.AiLanguageModel,
                    displayName: 'LLM',
                    required: true,
                    maxConnections: 1,
                },
                {
                    type: n8n_workflow_1.NodeConnectionTypes.AiTool,
                    displayName: 'Tools',
                    maxConnections: undefined,
                },
            ],
            outputs: [n8n_workflow_1.NodeConnectionTypes.Main],
            properties: [
                {
                    displayName: 'State Management Workflow',
                    name: 'stateWorkflowId',
                    type: 'workflowSelector',
                    default: '',
                    required: true,
                    description: 'Select the workflow that handles state storage. The workflow must have an Execute Workflow Trigger with "operation" (supporting "get" and "set" values) and "content" input fields.',
                },
                {
                    displayName: 'This node will send "get" or "set" to the "operation" field and the state content to the "content" field when calling the State Management Workflow. By using this workflow approach, you can track and store state in any way you prefer - whether it\'s in a database, file system, cloud storage, or any other storage solution that fits your needs.',
                    name: 'stateWorkflowInfo',
                    type: 'notice',
                    default: '',
                },
                {
                    displayName: 'Session ID',
                    name: 'sessionId',
                    type: 'string',
                    default: '',
                    required: true,
                    description: 'Unique identifier for the conversation session',
                },
                {
                    displayName: 'User Message',
                    name: 'userMessage',
                    type: 'string',
                    default: '',
                    required: true,
                    typeOptions: {
                        rows: 4,
                    },
                    description: 'The message from the user that the agent should respond to',
                },
                {
                    displayName: 'System Prompt',
                    name: 'systemPrompt',
                    type: 'string',
                    default: "You're a helpful assistant",
                    typeOptions: {
                        rows: 6,
                    },
                    description: 'The system prompt that defines the agent\'s behavior and personality',
                },
                {
                    displayName: 'State Model',
                    name: 'stateModel',
                    type: 'json',
                    default: '',
                    placeholder: '{\n  "field_name": "Description of what this field tracks"\n}',
                    description: 'JSON object defining the state fields to track. Each key is a field name and value is its description.',
                },
                {
                    displayName: 'Enable Conversation History',
                    name: 'conversationHistory',
                    type: 'boolean',
                    default: false,
                    description: 'Whether to track and maintain conversation history across interactions',
                },
                {
                    displayName: 'Single Prompt State Tracking',
                    name: 'singlePromptStateTracking',
                    type: 'boolean',
                    default: true,
                    description: 'Whether to use single prompt mode (faster) or double prompt mode (more accurate state tracking)',
                },
            ],
        };
    }
    static formatConversationHistory(history) {
        if (!Array.isArray(history) || history.length === 0) {
            return "No previous conversation.";
        }
        return history.map(entry => `${entry.role}: ${entry.message}`).join("\n");
    }
    static cleanJsonResponse(jsonString) {
        let cleaned = jsonString.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '');
            cleaned = cleaned.replace(/\n?```\s*$/, '');
        }
        return cleaned.trim();
    }
    static prepareStateFieldsForTemplate(stateModel, state) {
        const result = {};
        for (const key of Object.keys(stateModel)) {
            const value = (key in state) ? state[key] : null;
            result[key] = (value === null || value === undefined) ? "" : value;
        }
        return result;
    }
    static parseToolResult(toolResult) {
        if (typeof toolResult !== 'string') {
            return toolResult;
        }
        try {
            return JSON.parse(toolResult);
        }
        catch (e) {
            return toolResult;
        }
    }
    static extractStateModelStructure(stateModel, prefix = '') {
        const fields = [];
        for (const [key, value] of Object.entries(stateModel)) {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                fields.push(...StatefulAIAgent.extractStateModelStructure(value, fullPath));
            }
            else {
                fields.push({
                    path: fullPath,
                    description: typeof value === 'string' ? value : JSON.stringify(value)
                });
            }
        }
        return fields;
    }
    static getNestedValue(obj, path) {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = current[part];
        }
        return current;
    }
    static setNestedValue(obj, path, value) {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (!(part in current) || typeof current[part] !== 'object' || current[part] === null || Array.isArray(current[part])) {
                current[part] = {};
            }
            current = current[part];
        }
        current[parts[parts.length - 1]] = value;
    }
    static parseTemplateWithNestedProps(template, input) {
        const variablePattern = /\{([^}]+)\}/g;
        let result = template;
        let match;
        const processedVars = new Set();
        const variables = [];
        while ((match = variablePattern.exec(template)) !== null) {
            const varName = match[1];
            if (!processedVars.has(varName)) {
                variables.push(varName);
                processedVars.add(varName);
            }
        }
        for (const varName of variables) {
            let value;
            if (varName.includes('.')) {
                value = StatefulAIAgent.getNestedValue(input, varName);
            }
            else {
                value = input[varName];
            }
            if (value === undefined || value === null) {
                value = '';
            }
            else if (typeof value === 'object') {
                value = JSON.stringify(value);
                value = value.replace(/\{/g, '{{').replace(/\}/g, '}}');
            }
            else {
                value = String(value);
            }
            const regex = new RegExp(`\\{${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g');
            result = result.replace(regex, value);
        }
        return result;
    }
    static mergeStateWithModel(updatedState, stateModel, currentState) {
        const mergedState = {};
        const initializeStructure = (model, target) => {
            for (const [key, value] of Object.entries(model)) {
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    target[key] = {};
                    initializeStructure(value, target[key]);
                }
                else {
                    target[key] = null;
                }
            }
        };
        initializeStructure(stateModel, mergedState);
        const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
        for (const field of modelFields) {
            const value = StatefulAIAgent.getNestedValue(updatedState, field.path);
            if (value !== undefined && value !== null) {
                StatefulAIAgent.setNestedValue(mergedState, field.path, value);
            }
            else {
                const currentValue = StatefulAIAgent.getNestedValue(currentState, field.path);
                if (currentValue !== undefined) {
                    StatefulAIAgent.setNestedValue(mergedState, field.path, currentValue);
                }
            }
        }
        return mergedState;
    }
    static async invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps) {
        const invokedToolNames = [];
        const toolResults = [];
        for (const toolInvocation of toolsToInvoke) {
            const { tool_name, reason, input_params, state_field } = toolInvocation;
            const tool = agentTools.find(t => t.name === tool_name || t.name.toLowerCase() === tool_name.toLowerCase());
            if (!tool) {
                continue;
            }
            try {
                const toolResult = await tool.invoke(input_params || {});
                toolResults.push({
                    tool_name,
                    state_field,
                    result: toolResult
                });
                let targetField = state_field;
                if (!targetField && (tool_name.toLowerCase().includes('steps') || (reason === null || reason === void 0 ? void 0 : reason.toLowerCase().includes('steps')))) {
                    targetField = 'task_steps';
                }
                if (targetField && targetField in stateModel) {
                    const parsedResult = StatefulAIAgent.parseToolResult(toolResult);
                    if (JSON.stringify(state[targetField]) !== JSON.stringify(parsedResult)) {
                        state[targetField] = parsedResult;
                        if (!stateChangedProps.includes(targetField)) {
                            stateChangedProps.push(targetField);
                        }
                    }
                }
                invokedToolNames.push(tool_name);
            }
            catch (error) {
                toolResults.push({
                    tool_name,
                    state_field,
                    error: error.message
                });
            }
        }
        return { invokedToolNames, toolResults };
    }
    static validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun) {
        const newState = parsedResult.state || {};
        for (const key of Object.keys(stateModel)) {
            if (!(key in newState)) {
                newState[key] = null;
            }
            state[key] = newState[key];
        }
        const changedProps = Object.keys(stateModel).filter(key => {
            const prevValue = prevStateModelOnly[key];
            const newValue = state[key];
            return JSON.stringify(prevValue) !== JSON.stringify(newValue);
        });
        if (isFirstRun && changedProps.length === 0) {
            return Object.keys(stateModel);
        }
        return changedProps;
    }
    async execute() {
        const items = this.getInputData();
        const returnData = [];
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                const userMessage = this.getNodeParameter('userMessage', itemIndex);
                const systemPrompt = this.getNodeParameter('systemPrompt', itemIndex, "You're a helpful assistant");
                const stateModelParam = this.getNodeParameter('stateModel', itemIndex, '');
                const conversationHistory = this.getNodeParameter('conversationHistory', itemIndex, false);
                const singlePromptStateTracking = this.getNodeParameter('singlePromptStateTracking', itemIndex, true);
                const stateWorkflowIdParam = this.getNodeParameter('stateWorkflowId', itemIndex);
                const stateWorkflowId = typeof stateWorkflowIdParam === 'object' && stateWorkflowIdParam !== null
                    ? stateWorkflowIdParam.value
                    : stateWorkflowIdParam;
                const sessionId = this.getNodeParameter('sessionId', itemIndex);
                if (!stateWorkflowId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management Workflow is required. Please select a workflow.', {
                        itemIndex,
                    });
                }
                if (!sessionId) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Session ID is required. Please provide a session identifier.', {
                        itemIndex,
                    });
                }
                let stateModelStr;
                if (typeof stateModelParam === 'object' && stateModelParam !== null) {
                    stateModelStr = JSON.stringify(stateModelParam);
                }
                else if (typeof stateModelParam === 'string') {
                    stateModelStr = stateModelParam;
                }
                else {
                    stateModelStr = '';
                }
                let stateModel = null;
                if (stateModelStr && stateModelStr.trim()) {
                    try {
                        stateModel = JSON.parse(stateModelStr);
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Invalid State Model JSON: ${error.message}`, {
                            itemIndex,
                        });
                    }
                }
                const llm = (await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiLanguageModel, 0));
                if (!llm) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'LLM is required but not connected', {
                        itemIndex,
                    });
                }
                let agentTools = [];
                try {
                    const toolsResult = await this.getInputConnectionData(n8n_workflow_1.NodeConnectionTypes.AiTool, 0);
                    if (toolsResult) {
                        if (Array.isArray(toolsResult)) {
                            agentTools = toolsResult.filter((tool) => tool && typeof tool.invoke === 'function');
                        }
                        else if (typeof toolsResult.invoke === 'function') {
                            agentTools = [toolsResult];
                        }
                    }
                }
                catch (error) {
                }
                if (!userMessage) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'User Message is required', {
                        itemIndex,
                    });
                }
                const callStateWorkflow = async (operation, content = '') => {
                    var _a, _b;
                    const inputData = {
                        sessionId,
                        operation,
                        content,
                    };
                    const result = await this.executeWorkflow({ id: stateWorkflowId }, [{
                            json: inputData
                        }]);
                    if (!((_b = (_a = result === null || result === void 0 ? void 0 : result.data) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b[0])) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'State Management workflow returned no data', {
                            itemIndex,
                        });
                    }
                    return result.data[0][0].json;
                };
                let prevState = {};
                let state = {};
                let stateChangedProps = [];
                if (stateModel || conversationHistory) {
                    const stateData = await callStateWorkflow("get");
                    prevState = stateData || {};
                }
                let conversationHistoryValue = null;
                if (conversationHistory) {
                    conversationHistoryValue = prevState.conversation_history || [];
                }
                let response = '';
                let stateFieldDescriptions = "";
                let prevStateModelOnly = {};
                let isFirstRun = false;
                if (stateModel) {
                    const prevStateHasFields = Object.keys(stateModel).some(key => key in prevState);
                    isFirstRun = !prevStateHasFields;
                    for (const key of Object.keys(stateModel)) {
                        prevStateModelOnly[key] = (key in prevState) ? prevState[key] : null;
                    }
                    const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                    stateFieldDescriptions = modelFields
                        .map(field => `- ${field.path}: ${field.description}`)
                        .join("\n");
                }
                const availableToolsDesc = agentTools.length > 0
                    ? agentTools.map(tool => `- ${tool.name}: ${tool.description || 'No description available'}`).join("\n")
                    : "No tools available";
                const useAgent = agentTools.length > 0;
                if (stateModel && singlePromptStateTracking) {
                    const formatExample = useAgent ? `{{
  "state": {{ /* all state model fields */ }},
  "tools_to_invoke": [
    {{"tool_name": "Name", "reason": "Why", "state_field": "field", "input_params": {{}}}}
  ]
}}` : `{{
  "state": {{ /* all state model fields */ }},
  "response": "Your response"
}}`;
                    const instructionText = useAgent
                        ? 'Specify tools if external data is needed. Do not generate response yet.'
                        : 'Provide a helpful response';
                    const humanMessageContent = `State Model:
{stateFields}

Current State:
{currentState}

${useAgent ? `Available Tools:
{availableTools}
` : ''}${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Tasks:
1. Extract information from the user message to fill missing or null state fields. If the user is providing information in response to a question, map it to the appropriate state field.
2. {instructionText}

Return ONLY valid JSON:
${formatExample}`;
                    const systemMessageForFirstCall = useAgent
                        ? `Analyze user message to update state and identify required tools.

Rules:
- Extract information from the user message to fill missing or null state fields
- If the user provides information that matches a state field description, update that field
- If a field is null/missing and the user message contains relevant information, update it
- Keep previous non-null values unless the user message explicitly changes them
- Understand conversational context - if the user is answering a question, extract the answer into the appropriate field
- Identify tools needed for missing state data that cannot be extracted from the message
- For each tool: tool_name, reason, state_field, input_params

Return ONLY valid JSON:
${formatExample}`
                        : '{systemPrompt}';
                    const combinedPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                        ['system', systemMessageForFirstCall],
                        ['human', humanMessageContent],
                    ]);
                    const combinedChain = runnables_1.RunnableSequence.from([
                        combinedPrompt,
                        llm,
                        new output_parsers_1.StringOutputParser(),
                    ]);
                    const stateFieldsForTemplate = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, prevStateModelOnly);
                    const inputVariables = {
                        user_message: userMessage,
                        stateFields: stateFieldDescriptions,
                        currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
                        instructionText: instructionText,
                        ...stateFieldsForTemplate
                    };
                    if (!useAgent) {
                        inputVariables.systemPrompt = systemPrompt;
                    }
                    if (useAgent) {
                        inputVariables.availableTools = availableToolsDesc;
                    }
                    if (conversationHistory && conversationHistoryValue) {
                        inputVariables.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                    }
                    const combinedResult = await combinedChain.invoke(inputVariables);
                    let toolsToInvoke = [];
                    try {
                        const cleanedResult = StatefulAIAgent.cleanJsonResponse(combinedResult);
                        const parsedResult = JSON.parse(cleanedResult);
                        stateChangedProps = StatefulAIAgent.validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun);
                        if (!useAgent) {
                            response = parsedResult.response || "";
                        }
                        if (useAgent) {
                            toolsToInvoke = parsedResult.tools_to_invoke || [];
                            if (!Array.isArray(toolsToInvoke)) {
                                toolsToInvoke = [];
                            }
                        }
                    }
                    catch (error) {
                        throw new Error(`Failed to parse combined JSON: ${error.message}`);
                    }
                    if (toolsToInvoke.length > 0) {
                        const { invokedToolNames, toolResults } = await StatefulAIAgent.invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps);
                        if (invokedToolNames.length > 0) {
                            const toolResultsSummary = toolResults.map(result => `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`).join('\n\n');
                            const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                            const stateModelStructureDesc = modelFields
                                .map(field => `- ${field.path}: ${field.description}`)
                                .join('\n');
                            const stateModelStructureJson = JSON.stringify(stateModel, null, 2);
                            const postToolHumanMessageContent = `State Model Structure:
{stateModelStructure}

State Fields:
{stateFields}

Current State:
{currentState}

Tool Results:
{toolResults}

${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Tools Invoked:
{toolsInvoked}

Rules:
- Update state to EXACTLY match state model structure
- Use EXACT field names from state model (e.g., "email_address" not "emailAddress")
- Map tool results to correct state fields
- Preserve nested structure
- Provide natural response

Return ONLY valid JSON:
{{
  "state": {{ /* exact state model structure */ }},
  "response": "Your response"
}}`;
                            const postToolCombinedPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', '{systemPrompt}'],
                                ['human', postToolHumanMessageContent],
                            ]);
                            const postToolCombinedChain = runnables_1.RunnableSequence.from([
                                postToolCombinedPrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const toolsInvokedDesc = invokedToolNames
                                .map((name, idx) => `${idx + 1}. ${name}`)
                                .join('\n');
                            const stateModelFields = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                            const postToolCombinedInput = {
                                systemPrompt: systemPrompt,
                                user_message: userMessage,
                                stateModelStructure: stateModelStructureJson,
                                stateFields: stateModelStructureDesc,
                                currentState: JSON.stringify(state, null, 2),
                                toolResults: toolResultsSummary,
                                toolsInvoked: toolsInvokedDesc,
                                ...stateModelFields
                            };
                            if (conversationHistory && conversationHistoryValue) {
                                postToolCombinedInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                            }
                            const postToolCombinedResult = await postToolCombinedChain.invoke(postToolCombinedInput);
                            try {
                                const cleanedResult = StatefulAIAgent.cleanJsonResponse(postToolCombinedResult);
                                const parsedResult = JSON.parse(cleanedResult);
                                if (parsedResult.state) {
                                    const mergedState = StatefulAIAgent.mergeStateWithModel(parsedResult.state, stateModel, state);
                                    for (const key of Object.keys(stateModel)) {
                                        const prevValue = state[key];
                                        const newValue = mergedState[key];
                                        if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
                                            state[key] = newValue;
                                            if (!stateChangedProps.includes(key)) {
                                                stateChangedProps.push(key);
                                            }
                                        }
                                    }
                                }
                                if (parsedResult.response) {
                                    response = parsedResult.response;
                                }
                            }
                            catch (error) {
                            }
                        }
                    }
                    else if (useAgent && toolsToInvoke.length === 0) {
                        const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                        const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                        const stateModelStructureDesc = modelFields
                            .map(field => `- ${field.path}: ${field.description}`)
                            .join('\n');
                        const responseHumanMessageContent = `State Model:
{stateFields}

Current State:
{currentState}

${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                        const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', responseHumanMessageContent],
                        ]);
                        const responseChain = runnables_1.RunnableSequence.from([
                            responsePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        const responseInput = {
                            systemPrompt: systemPrompt,
                            user_message: userMessage,
                            stateFields: stateModelStructureDesc,
                            currentState: JSON.stringify(state, null, 2),
                            ...stateFieldsForPrompt
                        };
                        if (conversationHistory && conversationHistoryValue) {
                            responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                        }
                        response = await responseChain.invoke(responseInput);
                    }
                }
                else if (stateModel && !singlePromptStateTracking) {
                    const stateAnalysisFormatExample = useAgent ? `{{
  "state": {{ /* all state model fields */ }},
  "tools_to_invoke": [
    {{"tool_name": "Name", "reason": "Why", "state_field": "field", "input_params": {{}}}}
  ]
}}` : `{{
  "state": {{ /* all state model fields */ }}
}}`;
                    const stateAnalysisSystemMessage = `Analyze user message to update state${useAgent ? ' and identify required tools' : ''}.

Rules:
- Extract information from the user message to fill missing or null state fields
- If the user provides information that matches a state field description, update that field
- If a field is null/missing and the user message contains relevant information, update it
- Keep previous non-null values unless the user message explicitly changes them
- Understand conversational context - if the user is answering a question, extract the answer into the appropriate field
${useAgent ? `- Identify tools needed for missing state data that cannot be extracted from the message
- For each tool: tool_name, reason, state_field, input_params` : ''}

Return ONLY valid JSON:
${stateAnalysisFormatExample}`;
                    const stateAnalysisHumanMessage = `State Model:
{stateFields}

Current State:
{currentState}

${useAgent ? `Available Tools:
{availableTools}
` : ''}${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {userMessage}

Analyze the user message and extract any information that matches the state field descriptions. If the user is providing information in response to a question, map it to the appropriate state field.`;
                    const stateAnalysisPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                        ['system', stateAnalysisSystemMessage],
                        ['human', stateAnalysisHumanMessage],
                    ]);
                    const stateAnalysisChain = runnables_1.RunnableSequence.from([
                        stateAnalysisPrompt,
                        llm,
                        new output_parsers_1.StringOutputParser(),
                    ]);
                    const stateAnalysisInput = {
                        stateFields: stateFieldDescriptions,
                        currentState: Object.keys(prevStateModelOnly).length > 0 ? JSON.stringify(prevStateModelOnly, null, 2) : "{}",
                        userMessage: userMessage,
                    };
                    if (useAgent) {
                        stateAnalysisInput.availableTools = availableToolsDesc;
                    }
                    if (conversationHistory && conversationHistoryValue) {
                        stateAnalysisInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                    }
                    const stateAnalysisResult = await stateAnalysisChain.invoke(stateAnalysisInput);
                    let toolsToInvoke = [];
                    try {
                        const cleanedResult = StatefulAIAgent.cleanJsonResponse(stateAnalysisResult);
                        const parsedResult = JSON.parse(cleanedResult);
                        stateChangedProps = StatefulAIAgent.validateAndExtractState(parsedResult, stateModel, state, prevStateModelOnly, stateChangedProps, isFirstRun);
                        if (useAgent) {
                            toolsToInvoke = parsedResult.tools_to_invoke || [];
                            if (!Array.isArray(toolsToInvoke)) {
                                toolsToInvoke = [];
                            }
                        }
                    }
                    catch (error) {
                        throw new Error(`Failed to parse state analysis JSON: ${error.message}`);
                    }
                    if (toolsToInvoke.length > 0) {
                        const { invokedToolNames, toolResults } = await StatefulAIAgent.invokeTools(toolsToInvoke, agentTools, stateModel, state, stateChangedProps);
                        if (invokedToolNames.length > 0) {
                            const toolResultsSummary = toolResults.map(result => `Tool: ${result.tool_name}
Target State Field: ${result.state_field || 'not specified'}
Result: ${JSON.stringify(result.result || result.error, null, 2)}`).join('\n\n');
                            const modelFields = StatefulAIAgent.extractStateModelStructure(stateModel);
                            const stateModelStructureDesc = modelFields
                                .map(field => `- ${field.path}: ${field.description}`)
                                .join('\n');
                            const stateModelStructureJson = JSON.stringify(stateModel, null, 2);
                            const postToolStateFormatExample = stateModelStructureJson.replace(/\{/g, '{{').replace(/\}/g, '}}');
                            const postToolStateSystemMessage = `Update state from tool results to EXACTLY match state model structure.

Rules:
- Return state object matching EXACT state model structure
- Use EXACT field names (e.g., "email_address" not "emailAddress")
- Map tool results to correct state fields
- Preserve nested structure
- Only include fields in state model

Return ONLY valid JSON matching state model structure.`;
                            const postToolStateHumanMessage = `State Model Structure:
{stateModelStructure}

State Fields:
{stateFields}

Current State:
{currentState}

Tool Results:
{toolResults}

User: {userMessage}

Format:
${postToolStateFormatExample}`;
                            const postToolStatePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', postToolStateSystemMessage],
                                ['human', postToolStateHumanMessage],
                            ]);
                            const postToolStateChain = runnables_1.RunnableSequence.from([
                                postToolStatePrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const postToolStateResult = await postToolStateChain.invoke({
                                stateModelStructure: stateModelStructureJson,
                                stateFields: stateModelStructureDesc,
                                currentState: JSON.stringify(state, null, 2),
                                toolResults: toolResultsSummary,
                                userMessage: userMessage,
                            });
                            try {
                                const cleanedResult = StatefulAIAgent.cleanJsonResponse(postToolStateResult);
                                const updatedState = JSON.parse(cleanedResult);
                                const mergedState = StatefulAIAgent.mergeStateWithModel(updatedState, stateModel, state);
                                for (const key of Object.keys(stateModel)) {
                                    const prevValue = state[key];
                                    const newValue = mergedState[key];
                                    if (JSON.stringify(prevValue) !== JSON.stringify(newValue)) {
                                        state[key] = newValue;
                                        if (!stateChangedProps.includes(key)) {
                                            stateChangedProps.push(key);
                                        }
                                    }
                                }
                            }
                            catch (error) {
                            }
                            const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                            const templateInput = {
                                ...state,
                                ...stateFieldsForPrompt
                            };
                            const processedSystemPrompt = StatefulAIAgent.parseTemplateWithNestedProps(systemPrompt, templateInput);
                            const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Respond naturally.`;
                            const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', processedSystemPrompt],
                                ['human', responseHumanMessageContent],
                            ]);
                            const responseChain = runnables_1.RunnableSequence.from([
                                responsePrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const responseInput = {
                                user_message: userMessage,
                            };
                            if (conversationHistory && conversationHistoryValue) {
                                responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                            }
                            response = await responseChain.invoke(responseInput);
                        }
                        else {
                            const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                            const templateInput = {
                                ...state,
                                ...stateFieldsForPrompt
                            };
                            const processedSystemPrompt = StatefulAIAgent.parseTemplateWithNestedProps(systemPrompt, templateInput);
                            const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Respond naturally.`;
                            const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                                ['system', processedSystemPrompt],
                                ['human', responseHumanMessageContent],
                            ]);
                            const responseChain = runnables_1.RunnableSequence.from([
                                responsePrompt,
                                llm,
                                new output_parsers_1.StringOutputParser(),
                            ]);
                            const responseInput = {
                                user_message: userMessage,
                            };
                            if (conversationHistory && conversationHistoryValue) {
                                responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                            }
                            response = await responseChain.invoke(responseInput);
                        }
                    }
                    else {
                        const stateFieldsForPrompt = StatefulAIAgent.prepareStateFieldsForTemplate(stateModel, state);
                        const templateInput = {
                            ...state,
                            ...stateFieldsForPrompt
                        };
                        const processedSystemPrompt = StatefulAIAgent.parseTemplateWithNestedProps(systemPrompt, templateInput);
                        const responseHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Provide a helpful and natural response.`;
                        const responsePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', processedSystemPrompt],
                            ['human', responseHumanMessageContent],
                        ]);
                        const responseChain = runnables_1.RunnableSequence.from([
                            responsePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        const responseInput = {
                            user_message: userMessage,
                        };
                        if (conversationHistory && conversationHistoryValue) {
                            responseInput.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                        }
                        response = await responseChain.invoke(responseInput);
                    }
                }
                else {
                    const stateForTemplate = {};
                    for (const [key, value] of Object.entries(state)) {
                        if (key !== 'conversation_history') {
                            stateForTemplate[key] = (value === null || value === undefined) ? "" : value;
                        }
                    }
                    const inputVariables = {
                        user_message: userMessage,
                        ...stateForTemplate
                    };
                    if (conversationHistory && conversationHistoryValue) {
                        inputVariables.conversation_history = StatefulAIAgent.formatConversationHistory(conversationHistoryValue);
                    }
                    inputVariables.systemPrompt = systemPrompt;
                    if (useAgent) {
                        const agentHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}You have access to tools. Use them when needed.

User: {user_message}

Think step-by-step and use tools when helpful.

{agent_scratchpad}`;
                        const agentPrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', agentHumanMessageContent],
                        ]);
                        try {
                            const agent = await (0, agents_1.createToolCallingAgent)({
                                llm: llm,
                                tools: agentTools,
                                prompt: agentPrompt,
                            });
                            const agentExecutorConfig = {
                                agent,
                                tools: agentTools,
                                verbose: true,
                                maxIterations: 10,
                                returnIntermediateSteps: false,
                            };
                            const agentExecutor = new agents_1.AgentExecutor(agentExecutorConfig);
                            const result = await agentExecutor.invoke(inputVariables);
                            response = result.output;
                        }
                        catch (error) {
                            throw new Error(`Agent failed: ${error.message}`);
                        }
                    }
                    else {
                        const simpleHumanMessageContent = `${conversationHistory ? `Previous Conversation:
{conversation_history}
` : ''}User: {user_message}

Respond naturally.`;
                        const simplePrompt = prompts_1.ChatPromptTemplate.fromMessages([
                            ['system', '{systemPrompt}'],
                            ['human', simpleHumanMessageContent],
                        ]);
                        const chain = runnables_1.RunnableSequence.from([
                            simplePrompt,
                            llm,
                            new output_parsers_1.StringOutputParser(),
                        ]);
                        inputVariables.systemPrompt = systemPrompt;
                        response = await chain.invoke(inputVariables);
                    }
                }
                if (conversationHistory && conversationHistoryValue) {
                    conversationHistoryValue.push({
                        role: "user",
                        message: userMessage
                    });
                    conversationHistoryValue.push({
                        role: "assistant",
                        message: response
                    });
                    state.conversation_history = conversationHistoryValue;
                    if (!stateChangedProps.includes('conversation_history')) {
                        stateChangedProps.push('conversation_history');
                    }
                }
                if ((stateModel || conversationHistory) && stateChangedProps.length > 0) {
                    await callStateWorkflow("set", JSON.stringify(state));
                }
                returnData.push({
                    json: {
                        response: response,
                        state: state,
                        prevState: prevState,
                        stateChangedProps: stateChangedProps,
                    },
                    pairedItem: itemIndex,
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
                        error,
                        pairedItem: itemIndex
                    });
                }
                else {
                    if (error.context) {
                        error.context.itemIndex = itemIndex;
                        throw error;
                    }
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                        itemIndex,
                    });
                }
            }
        }
        return [returnData];
    }
}
exports.StatefulAIAgent = StatefulAIAgent;
//# sourceMappingURL=StatefulAIAgent.node.js.map