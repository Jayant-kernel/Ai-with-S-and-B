from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams
from pipecat.workers.runner import WorkerRunner

from saathi_voice.config import VoiceConfig
from saathi_voice.gated_conversation import GatedConversationProcessor
from saathi_voice.prompts import COMPANION_INSTRUCTIONS

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env.local", override=False)
load_dotenv(PROJECT_ROOT / "voice-service" / ".env", override=False)


def transport_parameters(enable_exotel: bool):
    params = {
        "webrtc": lambda: TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    }
    if enable_exotel:
        params["exotel"] = lambda: FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        )
    return params


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments, config: VoiceConfig):
    if config.enable_exotel and not config.enable_model_safety:
        raise RuntimeError(
            "Exotel is fenced off until ENABLE_MODEL_SAFETY=true and the safety gate is validated."
        )

    stt = SarvamSTTService(
        api_key=config.sarvam_api_key,
        mode=config.stt_mode,
        settings=SarvamSTTService.Settings(model=config.stt_model),
    )
    llm = GatedConversationProcessor(
        api_key=config.groq_api_key,
        conversation_model=config.conversation_model,
        safety_model=config.safety_model,
        system_instruction=COMPANION_INSTRUCTIONS,
        enable_model_safety=config.enable_model_safety,
        tts_language=config.tts_language,
        model_timeout_seconds=config.model_timeout_seconds,
        safety_timeout_seconds=config.safety_timeout_seconds,
    )
    tts = SarvamTTSService(
        api_key=config.sarvam_api_key,
        settings=SarvamTTSService.Settings(
            model=config.tts_model,
            voice=config.tts_voice,
            language=config.tts_language,
            pace=config.tts_pace,
        ),
    )

    context = LLMContext()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            # Smart Turn V3 is Pipecat 1.7's default stop strategy. Silero detects
            # speech pauses; Smart Turn decides whether the thought is complete.
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.2)),
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,  # Holds the complete reply until input and output safety pass.
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
    )
    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(_transport, _client):
        logger.info("Voice client connected")
        context.add_message(
            {
                "role": "developer",
                "content": "Greet the person briefly and leave space for them to speak.",
            }
        )
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport, _client):
        logger.info("Voice client disconnected")
        await runner.cancel()

    await runner.run()


async def bot(runner_args: RunnerArguments):
    config = VoiceConfig.from_env()
    transport = await create_transport(
        runner_args,
        transport_parameters(config.enable_exotel),
    )
    await run_bot(transport, runner_args, config)


if __name__ == "__main__":
    from pipecat.runner.run import main

    os.environ.setdefault("PIPECAT_SMART_TURN_LOG_DATA", "false")
    main()
